import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface DocumentViewerProps {
  mode: string;
  uri?: string;
  textContent: string;
  base64Content: string | null;
  fontSize: number;
}

function buildPdfHtml(base64: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0" />
  <style>
    body { margin: 0; padding: 12px; background: #0B1120; color: #E2E8F0; font-family: sans-serif; }
    canvas { width: 100% !important; height: auto !important; margin-bottom: 12px; border-radius: 6px; }
    #status { text-align: center; padding: 24px; color: #94A3B8; font-size: 14px; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
  <div id="status">Cargando documento PDF...</div>
  <div id="pages"></div>
  <script>
    (function() {
      var status = document.getElementById('status');
      if (!window.pdfjsLib) {
        status.textContent = 'Visor PDF sin conexión a PDF.js CDN. Conecta internet o abre un archivo TXT/Markdown.';
        return;
      }
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      var raw = atob('${base64}');
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
    })();
  </script>
</body>
</html>`;
}

function buildEpubHtml(base64: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #0B1120; color: #E2E8F0; font-family: Georgia, serif; }
    #viewer { height: calc(100vh - 54px); width: 100vw; overflow: hidden; }
    #nav { height: 54px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-top: 1px solid #1E293B; }
    button { background: #1E293B; color: #F8FAFC; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 600; }
    #status { padding: 24px; text-align: center; color: #94A3B8; font-family: sans-serif; }
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
    (function() {
      var status = document.getElementById('status');
      if (!window.ePub || !window.JSZip) {
        status.textContent = 'Visor EPUB sin conexión a epub.js CDN.';
        return;
      }
      var raw = atob('${base64}');
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      var book = ePub(bytes.buffer);
      rendition = book.renderTo('viewer', { width: '100%', height: '100%', spread: 'none' });
      rendition.themes.default({ body: { color: '#E2E8F0', background: '#0B1120', 'font-size': '17px', 'line-height': '1.6' } });
      rendition.display().then(function() { status.style.display = 'none'; });
    })();
  </script>
</body>
</html>`;
}

/**
 * Visor unificado para texto plano, artículos web, PDF local (base64 + PDF.js) y EPUB local (epub.js).
 */
export function DocumentViewer({
  mode,
  uri,
  textContent,
  base64Content,
  fontSize,
}: DocumentViewerProps) {
  const embeddedHtml = useMemo(() => {
    if (!base64Content) return null;
    if (mode === 'pdf') return buildPdfHtml(base64Content);
    if (mode === 'epub') return buildEpubHtml(base64Content);
    return null;
  }, [mode, base64Content]);

  if (mode === 'web' && uri) {
    return <WebView source={{ uri }} style={styles.webview} />;
  }

  if ((mode === 'pdf' || mode === 'epub') && embeddedHtml) {
    return (
      <WebView
        originWhitelist={['*']}
        source={{ html: embeddedHtml }}
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
});
