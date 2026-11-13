import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB límite seguro para puente WebView
const BASE64_CHUNK_SIZE = 256 * 1024; // 256 KB por fragmento

interface DocumentViewerProps {
  mode: string;
  uri?: string;
  textContent: string;
  base64Content: string | null;
  fileTooLargeError?: string | null;
  fontSize: number;
}

function buildPdfShellHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0" />
  <style>
    body { margin: 0; padding: 12px; background: #0B1120; color: #E2E8F0; font-family: sans-serif; }
    canvas { width: 100% !important; height: auto !important; margin-bottom: 12px; border-radius: 6px; }
    #status { text-align: center; padding: 24px; color: #94A3B8; font-size: 14px; line-height: 1.5; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <div id="status">Cargando documento PDF...</div>
  <div id="pages"></div>
  <script>
    window.__docChunks = [];
    window.__appendDocChunk = function(chunk) {
      window.__docChunks.push(chunk);
    };
    window.__renderDocument = function() {
      var status = document.getElementById('status');
      if (!window.pdfjsLib) {
        status.textContent = 'Sin conexión para cargar PDF.js (CDN). Conéctate a internet o usa archivos TXT/Markdown para lectura 100% offline.';
        return;
      }
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        var b64 = window.__docChunks.join('');
        window.__docChunks = [];
        var raw = atob(b64);
        b64 = '';
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        pdfjsLib.getDocument({ data: bytes }).promise.then(function(pdf) {
          status.style.display = 'none';
          var container = document.getElementById('pages');
          var total = Math.min(pdf.numPages, 40);
          for (var p = 1; p <= total; p++) {
            (function(pageNum) {
              pdf.getPage(pageNum).then(function(page) {
                var viewport = page.getViewport({ scale: 1.5 });
                var canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                container.appendChild(canvas);
                page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport });
              });
            })(p);
          }
        }).catch(function(err) {
          status.textContent = 'Error abriendo PDF: ' + err.message;
        });
      } catch (e) {
        status.textContent = 'Error procesando PDF: ' + e.message;
      }
    };
  </script>
</body>
</html>`;
}

function buildEpubShellHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #0B1120; color: #E2E8F0; font-family: Georgia, serif; }
    #viewer { height: calc(100vh - 54px); width: 100vw; overflow: hidden; }
    #nav { height: 54px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-top: 1px solid #1E293B; }
    button { background: #1E293B; color: #F8FAFC; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 600; }
    #status { padding: 24px; text-align: center; color: #94A3B8; font-family: sans-serif; font-size: 14px; line-height: 1.5; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js"></script>
</head>
<body>
  <div id="status">Cargando libro EPUB...</div>
  <div id="viewer"></div>
  <div id="nav">
    <button onclick="rendition && rendition.prev()">Anterior</button>
    <button onclick="rendition && rendition.next()">Siguiente</button>
  </div>
  <script>
    var rendition = null;
    window.__docChunks = [];
    window.__appendDocChunk = function(chunk) {
      window.__docChunks.push(chunk);
    };
    window.__renderDocument = function() {
      var status = document.getElementById('status');
      if (!window.ePub || !window.JSZip) {
        status.textContent = 'Sin conexión para cargar epub.js (CDN). Conéctate a internet o usa archivos TXT/Markdown para lectura 100% offline.';
        return;
      }
      try {
        var b64 = window.__docChunks.join('');
        window.__docChunks = [];
        var raw = atob(b64);
        b64 = '';
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        var book = ePub(bytes.buffer);
        rendition = book.renderTo('viewer', { width: '100%', height: '100%', spread: 'none' });
        rendition.themes.default({ body: { color: '#E2E8F0', background: '#0B1120', 'font-size': '17px', 'line-height': '1.6' } });
        rendition.display().then(function() { status.style.display = 'none'; });
      } catch (e) {
        status.textContent = 'Error procesando EPUB: ' + e.message;
      }
    };
  </script>
</body>
</html>`;
}

/**
 * Visor unificado para texto plano, artículos web, PDF local y EPUB local.
 * Transfiere el Base64 en fragmentos de 256 KB vía `injectJavaScript` para evitar OOM.
 */
export function DocumentViewer({
  mode,
  uri,
  textContent,
  base64Content,
  fileTooLargeError,
  fontSize,
}: DocumentViewerProps) {
  const webViewRef = useRef<WebView>(null);
  const injectedOnceRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  const shellHtml = useMemo(() => {
    injectedOnceRef.current = false;
    if (mode === 'pdf') return buildPdfShellHtml();
    if (mode === 'epub') return buildEpubShellHtml();
    return null;
  }, [mode, base64Content]);

  const handleShellLoaded = useCallback(() => {
    if (!base64Content || !webViewRef.current || injectedOnceRef.current) {
      return;
    }
    injectedOnceRef.current = true;

    const injectChunk = (index: number) => {
      if (!webViewRef.current) return;
      if (index >= base64Content.length) {
        webViewRef.current.injectJavaScript(`window.__renderDocument();true;`);
        rafIdRef.current = null;
        return;
      }

      const slice = base64Content.slice(index, index + BASE64_CHUNK_SIZE);
      webViewRef.current.injectJavaScript(
        `window.__appendDocChunk(${JSON.stringify(slice)});true;`
      );

      // Libera el hilo JS entre iteraciones para mantener la UI fluida
      rafIdRef.current = requestAnimationFrame(() =>
        injectChunk(index + BASE64_CHUNK_SIZE)
      );
    };

    injectChunk(0);
  }, [base64Content]);

  if (fileTooLargeError) {
    return (
      <View style={styles.loadingBox}>
        <Text style={styles.errorText}>{fileTooLargeError}</Text>
      </View>
    );
  }

  if (mode === 'web' && uri) {
    return <WebView source={{ uri }} style={styles.webview} />;
  }

  if ((mode === 'pdf' || mode === 'epub') && shellHtml && base64Content) {
    return (
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: shellHtml }}
        onLoadEnd={handleShellLoaded}
        javaScriptEnabled
        domStorageEnabled
        style={styles.webview}
      />
    );
  }

  if (mode === 'pdf' || mode === 'epub') {
    return (
      <View style={styles.loadingBox}>
        <Text style={styles.loadingText}>
          Preparando documento {mode.toUpperCase()}...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.textScroll}
      contentContainerStyle={styles.textScrollContent}
    >
      <Text
        style={[
          styles.readerBody,
          { fontSize, lineHeight: fontSize * 1.6 },
        ]}
      >
        {textContent}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  textScroll: {
    flex: 1,
  },
  textScrollContent: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 60,
  },
  readerBody: {
    color: '#E2E8F0',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  errorText: {
    color: '#FB7185',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
