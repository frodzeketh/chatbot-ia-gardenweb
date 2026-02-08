/**
 * Chatbot Widget - Script de Integración
 * 
 * INSTALACIÓN EN TU WEB PHP:
 * Añade esta línea antes de </body>:
 * 
 * <script src="https://TU-DOMINIO-RAILWAY.up.railway.app/embed.js"></script>
 * 
 * OPCIONES DE PERSONALIZACIÓN:
 * <script 
 *   src="https://TU-DOMINIO.railway.app/embed.js"
 *   data-position="right"
 *   data-primary-color="#4F46E5"
 *   data-theme="light"
 * ></script>
 */
(function() {
  'use strict';

  // Evitar cargar múltiples veces
  if (window.ChatbotWidgetLoaded) return;
  window.ChatbotWidgetLoaded = true;

  // Obtener URL base del script
  const currentScript = document.currentScript;
  const scriptSrc = currentScript.src;
  const baseUrl = scriptSrc.substring(0, scriptSrc.lastIndexOf('/'));

  // Opciones desde data attributes
  const options = {
    position: currentScript.getAttribute('data-position') || 'right',
    primaryColor: currentScript.getAttribute('data-primary-color') || '#3D6B35',
    theme: currentScript.getAttribute('data-theme') || 'light'
  };

  function createWidget() {
    // Crear contenedor
    const container = document.createElement('div');
    container.id = 'chatbot-widget-wrapper';
    container.style.cssText = `
      position: fixed !important;
      bottom: 0 !important;
      right: 0 !important;
      width: 420px !important;
      height: 580px !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      border: none !important;
      background: transparent !important;
      margin: 0 !important;
      padding: 0 !important;
    `;

    // Crear iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'chatbot-widget-frame';
    iframe.src = `${baseUrl}/widget.html`;
    iframe.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      background: transparent !important;
      pointer-events: auto !important;
      margin: 0 !important;
      padding: 0 !important;
    `;
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');

    container.appendChild(iframe);
    document.body.appendChild(container);

    // Enviar configuración al iframe cuando cargue
    iframe.onload = function() {
      iframe.contentWindow.postMessage({
        type: 'chatbot-config',
        apiUrl: baseUrl,
        config: options
      }, '*');
    };

    // Responsive
    function handleResize() {
      if (window.innerWidth <= 400) {
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.left = '0';
        container.style.right = '0';
      } else {
        container.style.width = '420px';
        container.style.height = '580px';
        container.style.right = '0';
        container.style.left = 'auto';
      }
    }

    window.addEventListener('resize', handleResize);
    handleResize();

    return iframe;
  }

  // Esperar a que el DOM esté listo
  let iframe;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      iframe = createWidget();
    });
  } else {
    iframe = createWidget();
  }

  // API pública para control externo
  window.ChatbotWidget = {
    open: function() {
      const frame = document.getElementById('chatbot-widget-frame');
      if (frame) frame.contentWindow.postMessage({ type: 'chatbot-open' }, '*');
    },
    close: function() {
      const frame = document.getElementById('chatbot-widget-frame');
      if (frame) frame.contentWindow.postMessage({ type: 'chatbot-close' }, '*');
    },
    toggle: function() {
      const frame = document.getElementById('chatbot-widget-frame');
      if (frame) frame.contentWindow.postMessage({ type: 'chatbot-toggle' }, '*');
    },
    destroy: function() {
      const wrapper = document.getElementById('chatbot-widget-wrapper');
      if (wrapper) wrapper.remove();
      window.ChatbotWidgetLoaded = false;
    }
  };
})();
