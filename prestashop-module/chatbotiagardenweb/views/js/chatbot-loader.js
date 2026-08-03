/**
 * Loader minimo del modulo PrestaShop.
 * No descarga embed.js hasta que la pagina termino de cargar (event load + idle).
 */
(function () {
  'use strict';

  var EMBED_URL = 'https://web-production-174f3.up.railway.app/embed.js';

  function loadEmbed() {
    if (window.ChatbotWidgetLoaded) {
      return;
    }
    if (document.querySelector('script[data-chatbot-embed]')) {
      return;
    }

    var script = document.createElement('script');
    script.src = EMBED_URL;
    script.defer = true;
    script.setAttribute('data-chatbot-embed', '1');
    (document.body || document.documentElement).appendChild(script);
  }

  function scheduleEmbed() {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadEmbed, { timeout: 3000 });
    } else {
      setTimeout(loadEmbed, 1);
    }
  }

  if (document.readyState === 'complete') {
    scheduleEmbed();
  } else {
    window.addEventListener('load', scheduleEmbed, { once: true });
  }
})();
