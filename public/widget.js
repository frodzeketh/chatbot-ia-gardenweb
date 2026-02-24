/**
 * Widget de Chatbot - Script principal
 */
(function() {
  'use strict';

  // Configuración
  let API_BASE = window.location.origin;
  let deviceId = localStorage.getItem('chatbot_device_id') || generateDeviceId();
  let isOpen = false;
  let config = {};

  // Persistir deviceId - identificador anónimo único por dispositivo
  localStorage.setItem('chatbot_device_id', deviceId);

  // Elementos del DOM
  const container = document.getElementById('chatbot-container');
  const toggleBtn = document.getElementById('chatbot-toggle');
  const closeBtn = document.getElementById('close-chat');
  const messagesContainer = document.getElementById('chatbot-messages');
  const form = document.getElementById('chatbot-form');
  const input = document.getElementById('chatbot-input');
  const sendBtn = document.getElementById('chatbot-send');
  const attachBtn = document.getElementById('chatbot-attach');
  const imageInput = document.getElementById('chatbot-image-input');
  const imagePreview = document.getElementById('chatbot-image-preview');
  const botNameEl = document.getElementById('bot-name');
  const welcomeTimeEl = document.getElementById('welcome-time');
  const suggestionsEl = document.getElementById('suggestions');

  let pendingImage = null;

  // Escuchar mensajes del padre (iframe)
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'chatbot-config') {
      if (event.data.apiUrl) API_BASE = event.data.apiUrl;
      if (event.data.config) applyConfig(event.data.config);
    }
    if (event.data && event.data.type === 'chatbot-open') {
      if (!isOpen) openChat();
    }
    if (event.data && event.data.type === 'chatbot-close') {
      if (isOpen) closeChat();
    }
    if (event.data && event.data.type === 'chatbot-toggle') {
      toggleChat();
    }
  });

  // Elementos de la burbuja
  const attentionBubble = document.getElementById('attention-bubble');
  const bubbleClose = attentionBubble?.querySelector('.bubble-close');

  // Inicialización
  init();

  async function init() {
    // Mostrar hora en mensaje de bienvenida
    if (welcomeTimeEl) {
      welcomeTimeEl.textContent = formatTime(new Date());
    }

    // Cargar configuración del servidor
    try {
      const response = await fetch(`${API_BASE}/api/config`);
      const serverConfig = await response.json();
      applyConfig(serverConfig);
    } catch (e) {
      console.log('Usando configuración por defecto');
    }

    // Cargar historial de la sesión actual (para mantener conversación al recargar)
    await loadChatHistory();

    // Event listeners
    toggleBtn.addEventListener('click', handleToggleClick);
    closeBtn.addEventListener('click', closeChat);
    form.addEventListener('submit', handleSubmit);
    input.addEventListener('input', handleInputChange);
    if (attachBtn && imageInput) {
      attachBtn.addEventListener('click', () => imageInput.click());
      imageInput.addEventListener('change', handleImageSelect);
    }

    // Hacer el botón arrastrable
    initDraggable();

    // Sugerencias
    if (suggestionsEl) {
      suggestionsEl.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const text = btn.textContent;
          input.value = text;
          handleSubmit(new Event('submit'));
        });
      });
    }

    // Cerrar con Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) closeChat();
    });

    // Enlaces del chat: abrir en nueva pestaña (en embed, avisar al padre para evitar bloqueos)
    if (messagesContainer) {
      messagesContainer.addEventListener('click', function(e) {
        const a = e.target.closest('a[href^="http"]');
        if (!a || !a.href) return;
        const url = (a.getAttribute('href') || a.href).trim();
        if (!url || url === '#') return;
        e.preventDefault();
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'chatbot-open-url', url: url }, '*');
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      });
    }

    // Burbuja de atención
    initAttentionBubble();
  }
  
  // Cargar historial de conversación del día
  async function loadChatHistory() {
    try {
      const response = await fetch(`${API_BASE}/api/chat/history?deviceId=${encodeURIComponent(deviceId)}`);
      const data = await response.json();
      
      if (data.messages && data.messages.length > 0) {
        // Ocultar sugerencias si hay historial
        if (suggestionsEl) suggestionsEl.classList.add('hidden');
        
        // Añadir cada mensaje del historial
        data.messages.forEach(msg => {
          const type = msg.role === 'user' ? 'user' : 'bot';
          addHistoryMessage(msg.content, type, msg.timestamp, msg.products, msg.imageUrl);
        });
        
        // Scroll al final
        scrollToBottom();
      }
    } catch (e) {
      console.log('No se pudo cargar historial:', e.message);
    }
  }
  
  // Añadir mensaje del historial (con timestamp, products e imageUrl para fotos del usuario)
  function addHistoryMessage(text, type, timestamp, products, imageUrl) {
    const div = document.createElement('div');
    div.className = `message ${type}-message`;
    
    let time;
    if (timestamp) {
      const date = new Date(timestamp);
      time = formatTime(date);
    } else {
      time = formatTime(new Date());
    }
    
    let content = type === 'bot' ? renderMarkdown(text) : escapeHtml(text);
    if (type === 'bot' && products && products.length > 0) {
      content = injectProductImagesIntoHtml(content, products);
    }
    const imageBlock = (type === 'user' && imageUrl) ? '<div class="message-user-image"><img src="' + (imageUrl || '').replace(/"/g, '&quot;') + '" alt="Foto enviada"></div>' : '';
    
    div.innerHTML = `
      <div class="message-bubble">
        ${imageBlock}
        <div class="message-text">${content}</div>
        <span class="message-time">${time}</span>
      </div>
    `;

    messagesContainer.appendChild(div);
  }
  
  function initAttentionBubble() {
    if (!attentionBubble) return;
    
    // Verificar si ya se mostró hoy
    const lastShown = localStorage.getItem('chatbot_bubble_shown');
    const today = new Date().toDateString();
    
    if (lastShown === today) {
      attentionBubble.style.display = 'none';
      return;
    }
    
    // Mostrar después de 2 segundos
    setTimeout(() => {
      attentionBubble.style.display = 'flex';
    }, 2000);
    
    // Ocultar después de 6 segundos
    setTimeout(() => {
      hideBubble();
    }, 8000);
    
    // Cerrar con botón X
    if (bubbleClose) {
      bubbleClose.addEventListener('click', (e) => {
        e.stopPropagation();
        hideBubble();
      });
    }
    
    // Cerrar al hacer click en la burbuja (abre el chat)
    attentionBubble.addEventListener('click', () => {
      hideBubble();
      if (!isOpen) openChat();
    });
  }
  
  function hideBubble() {
    if (!attentionBubble) return;
    attentionBubble.classList.add('hidden');
    localStorage.setItem('chatbot_bubble_shown', new Date().toDateString());
    
    // Remover del DOM después de la animación
    setTimeout(() => {
      attentionBubble.style.display = 'none';
    }, 300);
  }

  function applyConfig(cfg) {
    config = { ...config, ...cfg };
    if (cfg.botName && botNameEl) botNameEl.textContent = cfg.botName;
    if (cfg.primaryColor) {
      document.documentElement.style.setProperty('--primary', cfg.primaryColor);
    }
  }

  function toggleChat() {
    isOpen ? closeChat() : openChat();
  }

  function openChat() {
    isOpen = true;
    container.classList.add('open');
    input.focus();
    notifyParent();
  }

  function closeChat() {
    isOpen = false;
    container.classList.remove('open');
    notifyParent();
  }

  function notifyParent() {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'chatbot-state', isOpen }, '*');
    }
  }

  function handleInputChange() {
    // Opcional: cambiar estilo del botón según input
  }

  function handleImageSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    clearPendingImage();
    const reader = new FileReader();
    reader.onload = function() {
      pendingImage = reader.result;
      if (imagePreview) {
        imagePreview.innerHTML = '<div class="chatbot-image-preview-inner"><img src="' + pendingImage.replace(/"/g, '&quot;') + '" alt="Vista previa (máx. 1 imagen)"><button type="button" class="chatbot-image-preview-remove" aria-label="Quitar imagen">&times;</button></div>';
        imagePreview.classList.add('visible');
        imagePreview.querySelector('.chatbot-image-preview-remove').addEventListener('click', clearPendingImage);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function clearPendingImage() {
    pendingImage = null;
    if (imagePreview) {
      imagePreview.innerHTML = '';
      imagePreview.classList.remove('visible');
    }
    if (imageInput) imageInput.value = '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    
    const message = input.value.trim();
    if (!message && !pendingImage) return;

    // Ocultar sugerencias
    if (suggestionsEl) suggestionsEl.classList.add('hidden');

    const textToShow = message || '📷 [Foto adjunta]';
    addMessage(textToShow, 'user', null, pendingImage);
    input.value = '';
    const imageToSend = pendingImage;
    clearPendingImage();

    // Mostrar typing
    const typingEl = showTyping();

    try {
      const body = { message: message || '¿Qué me recomiendas según la foto?', deviceId };
      if (imageToSend) body.imageBase64 = imageToSend;
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      typingEl.remove();

      if (response.ok) {
        addMessage(data.message, 'bot', data.products);
        // Actualizar deviceId si el servidor lo devuelve diferente
        if (data.deviceId && data.deviceId !== deviceId) {
          deviceId = data.deviceId;
          localStorage.setItem('chatbot_device_id', deviceId);
        }
      } else {
        addMessage(data.error || 'Error al procesar el mensaje.', 'bot');
      }
    } catch (error) {
      console.error('Chatbot fetch error:', error.message || error, '→ URL:', API_BASE + '/api/chat');
      typingEl.remove();
      addMessage('Error de conexión. Comprueba que el servidor esté en marcha y que la URL sea correcta (consola del navegador para más detalle).', 'bot');
    }

    input.focus();
  }

  function addMessage(text, type, products, userImage) {
    const div = document.createElement('div');
    div.className = `message ${type}-message`;
    
    const time = formatTime(new Date());
    let content = type === 'bot' ? renderMarkdown(text) : escapeHtml(text);
    if (type === 'bot' && products && products.length > 0) {
      content = injectProductImagesIntoHtml(content, products);
    }
    const imageBlock = (type === 'user' && userImage) ? '<div class="message-user-image"><img src="' + (userImage || '').replace(/"/g, '&quot;') + '" alt="Foto enviada"></div>' : '';
    
    div.innerHTML = `
      <div class="message-bubble">
        ${imageBlock}
        <div class="message-text">${content}</div>
        <span class="message-time">${time}</span>
      </div>
    `;

    messagesContainer.appendChild(div);
    scrollToBottom();
  }

  // Card de producto: imagen arriba, borde, denominación (15 chars), stock, ref, precio, borde, ver producto
  function buildProductCard(p) {
    const base = (API_BASE || window.location.origin).replace(/\/$/, '');
    const imgSrc = (p.imageId && p.id)
      ? base + '/api/articulos/image/' + encodeURIComponent(p.id) + '/' + encodeURIComponent(p.imageId)
      : '';
    const fullName = (p.name || '').trim().replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const name = fullName.length > 15 ? fullName.slice(0, 15) + '…' : fullName;
    const price = p.price || 'Consultar';
    const stock = p.stock != null && p.stock !== '' ? String(p.stock) : 'Consultar';
    const ref = p.reference || '—';
    const url = (p.product_url || '').trim() || 'https://plantasdehuerto.com/';
    const imgHtml = imgSrc
      ? '<div class="product-card-image"><img src="' + imgSrc + '" alt="" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>'
      : '';
    return '<div class="product-card">' +
      imgHtml +
      '<div class="product-card-border"></div>' +
      '<div class="product-card-body">' +
      '<div class="product-card-title">' + name + '</div>' +
      '<div class="product-card-row">Stock: ' + stock + '</div>' +
      '<div class="product-card-row">Referencia: ' + ref + '</div>' +
      '<div class="product-card-row">Precio: ' + price + '</div>' +
      '<div class="product-card-border"></div>' +
      '<a href="' + url.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer" class="product-card-link">Ver producto</a>' +
      '</div></div>';
  }

  function injectProductImagesIntoHtml(html, products) {
    if (!products || products.length === 0) return html;
    const base = (API_BASE || window.location.origin).replace(/\/$/, '');
    for (let i = products.length - 1; i >= 0; i--) {
      const p = products[i];
      const namePrefix = (p.name || '').trim().slice(0, 22);
      if (!namePrefix) continue;
      const nameIdx = html.toLowerCase().indexOf(namePrefix.toLowerCase());
      if (nameIdx === -1) continue;
      const startIdx = Math.max(html.lastIndexOf('<p>', nameIdx), html.lastIndexOf('<p ', nameIdx));
      if (startIdx === -1) continue;
      const firstPEnd = html.indexOf('</p>', nameIdx);
      if (firstPEnd === -1) continue;
      const endIdx = html.indexOf('</p>', firstPEnd + 4);
      const blockEnd = endIdx !== -1 ? endIdx + 4 : firstPEnd + 4;
      const cardHtml = buildProductCard({
        id: p.id,
        imageId: p.imageId,
        name: p.name,
        price: p.price,
        stock: p.stock,
        reference: p.reference,
        product_url: p.product_url
      });
      html = html.slice(0, startIdx) + cardHtml + html.slice(blockEnd);
    }
    return html;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'message bot-message typing';
    div.innerHTML = `
      <div class="message-bubble">
        <div class="typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    messagesContainer.appendChild(div);
    scrollToBottom();
    return div;
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function formatTime(date) {
    return date.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit'
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Renderizar markdown con marked.js
  function renderMarkdown(text) {
    let html;
    if (typeof marked !== 'undefined') {
      html = marked.parse(text);
    } else {
      // Fallback si marked no cargó
      html = text.replace(/\n/g, '<br>');
    }
    
    // Imágenes del chat: resolver /api/articulos/image/ y /api/chat/image/ con API_BASE + clase y onerror (ocultar si falla)
    const base = (API_BASE || window.location.origin).replace(/\/$/, '');
    html = html.replace(/<img([^>]*)\ssrc="(\/api\/(?:articulos|chat)\/image\/[^"]+)"/gi, (_, attrs, path) => {
      return '<img' + attrs + ' class="chat-product-img" src="' + base + path + '" loading="lazy" onerror="this.style.display=\'none\'"';
    });
    
    // Envolver tablas en contenedor scrollable
    html = html.replace(/<table>/g, '<div class="table-wrapper"><table>');
    html = html.replace(/<\/table>/g, '</table></div>');
    
    // Convertir links de WhatsApp a componente bonito
    html = convertWhatsAppLinks(html);
    
    // Convertir tarjeta de contacto especial
    html = convertContactCard(html);
    
    return html;
  }
  
  // Convertir links de WhatsApp a tarjeta moderna
  function convertWhatsAppLinks(html) {
    const waLinkRegex = /<a[^>]*href=["'](https?:\/\/(wa\.me|api\.whatsapp\.com)\/(\d+)[^"']*)["'][^>]*>[^<]*<\/a>/gi;
    
    return html.replace(waLinkRegex, (match, url, domain, phone) => {
      return createContactCard(phone);
    });
  }
  
  // Convertir formato [CONTACTO] a tarjeta moderna
  function convertContactCard(html) {
    const contactRegex = /\[CONTACTO:([^:]+):([^:]+):([^\]]+)\]/g;
    
    return html.replace(contactRegex, (match, whatsapp, telefono, email) => {
      return createContactCard(whatsapp, telefono);
    });
  }
  
  // Crear tarjeta de contacto
  function createContactCard(whatsapp, telefono) {
    const waIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
    
    return `<div class="contact-card">
      <img src="logo-crop-huerto.png" alt="El Huerto Deitana" class="contact-card-logo">
      <div class="contact-card-row">
        <span class="contact-card-msg">¿Necesitas ayuda?</span>
        <a href="https://wa.me/${whatsapp}" target="_blank" rel="noopener" class="contact-card-btn wa">${waIcon} Contactar</a>
      </div>
    </div>`;
  }

  // Genera un identificador único anónimo por dispositivo (UUID v4)
  function generateDeviceId() {
    // Usar crypto.randomUUID si está disponible (navegadores modernos)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return 'dev_' + crypto.randomUUID();
    }
    // Fallback para navegadores antiguos
    return 'dev_' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ============================================
  // DRAGGABLE - Arrastrar y ocultar en bordes
  // ============================================
  let isDragging = false;
  let hasDragged = false;
  let startX, startY, initialX, initialY;
  let buttonHidden = false;

  function handleToggleClick(e) {
    // Solo abrir chat si no se arrastró
    if (!hasDragged && !buttonHidden) {
      toggleChat();
    }
    hasDragged = false;
  }

  function initDraggable() {
    // Mouse events
    toggleBtn.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    
    // Touch events
    toggleBtn.addEventListener('touchstart', dragStart, { passive: false });
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('touchend', dragEnd);
    
    // Estilo para indicar que es arrastrable
    toggleBtn.style.cursor = 'grab';
    toggleBtn.style.touchAction = 'none';
  }

  function dragStart(e) {
    if (isOpen || buttonHidden) return;
    
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
    
    // Cambiar a position fixed para mover libremente
    toggleBtn.style.position = 'fixed';
    toggleBtn.style.left = initialX + 'px';
    toggleBtn.style.top = initialY + 'px';
    toggleBtn.style.right = 'auto';
    toggleBtn.style.bottom = 'auto';
  }

  function drag(e) {
    if (!isDragging) return;
    e.preventDefault();
    
    let currentX, currentY;
    if (e.type === 'touchmove') {
      currentX = e.touches[0].clientX;
      currentY = e.touches[0].clientY;
    } else {
      currentX = e.clientX;
      currentY = e.clientY;
    }
    
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    
    // Si se movió más de 5px, es un drag no un click
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      hasDragged = true;
    }
    
    let newX = initialX + deltaX;
    let newY = initialY + deltaY;
    
    // Límites de la pantalla
    const btnWidth = toggleBtn.offsetWidth;
    const btnHeight = toggleBtn.offsetHeight;
    newX = Math.max(-btnWidth / 2, Math.min(window.innerWidth - btnWidth / 2, newX));
    newY = Math.max(0, Math.min(window.innerHeight - btnHeight, newY));
    
    toggleBtn.style.left = newX + 'px';
    toggleBtn.style.top = newY + 'px';
    
    // Efecto visual solo cuando está MUY cerca de salir
    if (newX < -10 || newX > window.innerWidth - btnWidth + 10) {
      toggleBtn.style.opacity = '0.5';
      toggleBtn.style.transform = 'scale(0.9)';
    } else {
      toggleBtn.style.opacity = '1';
      toggleBtn.style.transform = 'scale(1)';
    }
  }

  function dragEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    toggleBtn.style.cursor = 'grab';
    toggleBtn.style.transition = 'all 0.3s ease';
    toggleBtn.style.opacity = '1';
    toggleBtn.style.transform = 'scale(1)';
    
    const rect = toggleBtn.getBoundingClientRect();
    const btnWidth = toggleBtn.offsetWidth;
    
    // Solo desaparece si está MUY afuera (más de la mitad del botón fuera de pantalla)
    const halfButton = btnWidth / 2;
    
    // Si más de la mitad está fuera por la izquierda, desaparecer
    if (rect.left < -halfButton + 10) {
      hideButton('left');
      return;
    }
    
    // Si más de la mitad está fuera por la derecha, desaparecer
    if (rect.right > window.innerWidth + halfButton - 10) {
      hideButton('right');
      return;
    }
    
    // Quedarse donde lo dejó (no volver a posición original)
    // Solo ajustar si está parcialmente fuera de la pantalla
    let finalX = rect.left;
    let finalY = rect.top;
    
    // Mantener dentro de los límites
    finalX = Math.max(10, Math.min(window.innerWidth - btnWidth - 10, finalX));
    finalY = Math.max(10, Math.min(window.innerHeight - toggleBtn.offsetHeight - 10, finalY));
    
    toggleBtn.style.left = finalX + 'px';
    toggleBtn.style.top = finalY + 'px';
  }

  function hideButton(direction) {
    buttonHidden = true;
    hasDragged = true;
    
    // Animar hacia afuera
    if (direction === 'left') {
      toggleBtn.style.left = '-80px';
    } else {
      toggleBtn.style.left = (window.innerWidth + 20) + 'px';
    }
    toggleBtn.style.opacity = '0';
    toggleBtn.style.transform = 'scale(0.5)';
    
    // Después de la animación, ocultar completamente
    setTimeout(() => {
      toggleBtn.style.visibility = 'hidden';
    }, 300);
  }

})();
