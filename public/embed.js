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

  if (window.ChatbotWidgetLoaded) return;
  window.ChatbotWidgetLoaded = true;

  const currentScript = document.currentScript;
  const scriptSrc = currentScript.src;
  const baseUrl = scriptSrc.substring(0, scriptSrc.lastIndexOf('/'));

  const options = {
    position: currentScript.getAttribute('data-position') || 'right',
    primaryColor: currentScript.getAttribute('data-primary-color') || '#3D6B35',
    theme: currentScript.getAttribute('data-theme') || 'light'
  };

  function createWidget() {
    const container = document.createElement('div');
    container.id = 'chatbot-widget-wrapper';
    container.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      border: none !important;
      background: transparent !important;
      margin: 0 !important;
      padding: 0 !important;
    `;

    // Botón flotante EN LA PÁGINA PADRE (no en iframe) → no hay capa que bloquee clics
    const btnSize = 60;
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'chatbot-embed-toggle';
    toggleBtn.setAttribute('aria-label', 'Abrir asistente');
    toggleBtn.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      left: auto !important;
      width: ${btnSize}px !important;
      height: ${btnSize}px !important;
      border-radius: 50% !important;
      background: white !important;
      border: 1px solid rgba(0,0,0,0.1) !important;
      cursor: grab !important;
      padding: 0 !important;
      margin: 0 !important;
      box-shadow: 0 2px 12px rgba(0,0,0,0.1) !important;
      pointer-events: auto !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      overflow: hidden !important;
      transition: transform 0.25s ease, box-shadow 0.25s ease !important;
    `;
    const img = document.createElement('img');
    img.src = baseUrl + '/logo-crop-huerto.png';
    img.alt = 'Chat';
    img.style.cssText = 'width:100%!important;height:100%!important;object-fit:contain!important;pointer-events:none!important;';
    toggleBtn.appendChild(img);

    // Iframe SOLO para la ventana del chat (desktop: 360x500; responsive: pantalla completa)
    const iframe = document.createElement('iframe');
    iframe.id = 'chatbot-widget-frame';
    iframe.src = baseUrl + '/widget.html';
    const MOBILE_BREAKPOINT = 480;
    function applyIframeResponsive() {
      const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      if (isMobile) {
        iframe.style.top = '0';
        iframe.style.left = '0';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '100vw';
        iframe.style.height = '100vh';
        iframe.style.height = '100dvh';
        iframe.style.maxWidth = 'none';
        iframe.style.maxHeight = 'none';
        iframe.style.borderRadius = '0';
        iframe.style.boxShadow = 'none';
      } else {
        iframe.style.top = 'auto';
        iframe.style.left = 'auto';
        iframe.style.right = '24px';
        iframe.style.bottom = '24px';
        iframe.style.width = '360px';
        iframe.style.height = '500px';
        iframe.style.maxWidth = 'calc(100vw - 32px)';
        iframe.style.maxHeight = 'calc(100vh - 100px)';
        iframe.style.borderRadius = '20px';
        iframe.style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)';
      }
    }
    iframe.style.cssText = `
      position: fixed !important;
      border: none !important;
      background: transparent !important;
      pointer-events: auto !important;
      z-index: 2147483646 !important;
      margin: 0 !important;
      padding: 0 !important;
      display: none !important;
    `;
    applyIframeResponsive();
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    window.addEventListener('resize', applyIframeResponsive);

    container.appendChild(toggleBtn);
    container.appendChild(iframe);
    document.body.appendChild(container);

    // Estado
    let chatOpen = false;
    let isDragging = false;
    let hasDragged = false;
    let startX, startY, initialX, initialY;
    let buttonHidden = false;

    let savedScrollY = 0;
    function showChat() {
      chatOpen = true;
      savedScrollY = window.scrollY || window.pageYOffset;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.top = -savedScrollY + 'px';
      iframe.style.display = 'block';
      toggleBtn.style.display = 'none';
      iframe.contentWindow && iframe.contentWindow.postMessage({ type: 'chatbot-open' }, '*');
    }

    function hideChat() {
      chatOpen = false;
      const scrollToRestore = savedScrollY;
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.top = '';
      iframe.style.display = 'none';
      if (!buttonHidden) toggleBtn.style.display = 'flex';
      iframe.contentWindow && iframe.contentWindow.postMessage({ type: 'chatbot-close' }, '*');
      // Restaurar scroll después del reflow para que la página no salte al cerrar
      requestAnimationFrame(function() {
        window.scrollTo(0, scrollToRestore);
        requestAnimationFrame(function() {
          window.scrollTo(0, scrollToRestore);
        });
      });
    }

    function onToggleClick() {
      if (hasDragged || buttonHidden) return;
      showChat();
      hasDragged = false;
    }

    // Arrastrar botón (en la página padre → usa window real, se mueve por toda la web)
    function dragStart(e) {
      if (chatOpen || buttonHidden) return;
      isDragging = true;
      hasDragged = false;
      toggleBtn.style.cursor = 'grabbing';
      toggleBtn.style.transition = 'none';
      const rect = toggleBtn.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      if (e.type === 'touchstart') {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      } else {
        startX = e.clientX;
        startY = e.clientY;
      }
    }

    function drag(e) {
      if (!isDragging) return;
      e.preventDefault();
      let cx, cy;
      if (e.type === 'touchmove') {
        cx = e.touches[0].clientX;
        cy = e.touches[0].clientY;
      } else {
        cx = e.clientX;
        cy = e.clientY;
      }
      if (Math.abs(cx - startX) > 5 || Math.abs(cy - startY) > 5) hasDragged = true;
      let newX = initialX + (cx - startX);
      let newY = initialY + (cy - startY);
      const w = toggleBtn.offsetWidth;
      const h = toggleBtn.offsetHeight;
      newX = Math.max(-w / 2, Math.min(window.innerWidth - w / 2, newX));
      newY = Math.max(0, Math.min(window.innerHeight - h, newY));
      toggleBtn.style.left = newX + 'px';
      toggleBtn.style.top = newY + 'px';
      toggleBtn.style.right = 'auto';
      toggleBtn.style.bottom = 'auto';
    }

    function dragEnd() {
      if (!isDragging) return;
      isDragging = false;
      toggleBtn.style.cursor = 'grab';
      toggleBtn.style.transition = 'all 0.25s ease';
      const rect = toggleBtn.getBoundingClientRect();
      const w = toggleBtn.offsetWidth;
      const half = w / 2;
      if (rect.left < -half + 10) {
        buttonHidden = true;
        hasDragged = true;
        toggleBtn.style.left = '-80px';
        toggleBtn.style.opacity = '0';
        setTimeout(function() { toggleBtn.style.visibility = 'hidden'; }, 300);
        return;
      }
      if (rect.right > window.innerWidth + half - 10) {
        buttonHidden = true;
        hasDragged = true;
        toggleBtn.style.left = (window.innerWidth + 20) + 'px';
        toggleBtn.style.opacity = '0';
        setTimeout(function() { toggleBtn.style.visibility = 'hidden'; }, 300);
        return;
      }
      let fx = Math.max(10, Math.min(window.innerWidth - w - 10, rect.left));
      let fy = Math.max(10, Math.min(window.innerHeight - toggleBtn.offsetHeight - 10, rect.top));
      toggleBtn.style.left = fx + 'px';
      toggleBtn.style.top = fy + 'px';
      hasDragged = false;
    }

    toggleBtn.addEventListener('mousedown', dragStart);
    toggleBtn.addEventListener('click', onToggleClick);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    toggleBtn.addEventListener('touchstart', dragStart, { passive: false });
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('touchend', dragEnd);
    toggleBtn.style.touchAction = 'none';

    iframe.onload = function() {
      iframe.contentWindow.postMessage({
        type: 'chatbot-config',
        apiUrl: baseUrl,
        config: Object.assign({}, options, { externalButton: true })
      }, '*');
    };

    window.addEventListener('message', function(event) {
      if (!event.data) return;
      if (event.data.type === 'chatbot-state' && event.data.isOpen === false) {
        hideChat();
      }
      if (event.data.type === 'chatbot-open-url' && event.data.url) {
        try { window.open(event.data.url, '_blank', 'noopener,noreferrer'); } catch (err) {}
      }
    });

    return iframe;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { createWidget(); });
  } else {
    createWidget();
  }

  window.ChatbotWidget = {
    open: function() {
      const frame = document.getElementById('chatbot-widget-frame');
      const btn = document.getElementById('chatbot-embed-toggle');
      if (frame && frame.contentWindow) {
        frame.style.display = 'block';
        if (btn) btn.style.display = 'none';
        frame.contentWindow.postMessage({ type: 'chatbot-open' }, '*');
      }
    },
    close: function() {
      const frame = document.getElementById('chatbot-widget-frame');
      const btn = document.getElementById('chatbot-embed-toggle');
      if (frame && frame.contentWindow) {
        frame.style.display = 'none';
        if (btn && !btn.style.visibility) btn.style.display = 'flex';
        frame.contentWindow.postMessage({ type: 'chatbot-close' }, '*');
      }
    },
    toggle: function() {
      const frame = document.getElementById('chatbot-widget-frame');
      if (frame) {
        if (frame.style.display === 'none') window.ChatbotWidget.open();
        else window.ChatbotWidget.close();
      }
    },
    destroy: function() {
      const wrapper = document.getElementById('chatbot-widget-wrapper');
      if (wrapper) wrapper.remove();
      window.ChatbotWidgetLoaded = false;
    }
  };
})();
