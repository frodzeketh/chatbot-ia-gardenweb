/**
 * Widget de Chatbot - Script principal
 */
(function() {
  'use strict';

  // Configuración
  let API_BASE = window.location.origin;
  let sessionId = localStorage.getItem('chatbot_session_id') || generateSessionId();
  let isOpen = false;
  let config = {};

  localStorage.setItem('chatbot_session_id', sessionId);

  // Elementos del DOM
  const container = document.getElementById('chatbot-container');
  const toggleBtn = document.getElementById('chatbot-toggle');
  const closeBtn = document.getElementById('close-chat');
  const messagesContainer = document.getElementById('chatbot-messages');
  const form = document.getElementById('chatbot-form');
  const input = document.getElementById('chatbot-input');
  const sendBtn = document.getElementById('chatbot-send');
  const botNameEl = document.getElementById('bot-name');
  const welcomeTimeEl = document.getElementById('welcome-time');
  const suggestionsEl = document.getElementById('suggestions');

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

    // Event listeners
    toggleBtn.addEventListener('click', handleToggleClick);
    closeBtn.addEventListener('click', closeChat);
    form.addEventListener('submit', handleSubmit);
    input.addEventListener('input', handleInputChange);
    
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
    
    // Burbuja de atención
    initAttentionBubble();
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

  async function handleSubmit(e) {
    e.preventDefault();
    
    const message = input.value.trim();
    if (!message) return;

    // Ocultar sugerencias
    if (suggestionsEl) suggestionsEl.classList.add('hidden');

    // Agregar mensaje del usuario
    addMessage(message, 'user');
    input.value = '';

    // Mostrar typing
    const typingEl = showTyping();

    try {
      console.log('Enviando a:', `${API_BASE}/api/chat`);
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId })
      });

      console.log('Respuesta status:', response.status);
      const data = await response.json();
      console.log('Datos recibidos:', data);
      typingEl.remove();

      if (response.ok) {
        addMessage(data.message, 'bot');
        sessionId = data.sessionId;
        localStorage.setItem('chatbot_session_id', sessionId);
      } else {
        addMessage(data.error || 'Error al procesar el mensaje.', 'bot');
      }
    } catch (error) {
      console.error('Error en fetch:', error);
      typingEl.remove();
      addMessage('Error de conexión. Por favor, verifica tu internet.', 'bot');
    }

    input.focus();
  }

  function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `message ${type}-message`;
    
    const time = formatTime(new Date());
    // Usar markdown para bot, escape para usuario
    const content = type === 'bot' ? renderMarkdown(text) : escapeHtml(text);
    
    div.innerHTML = `
      <div class="message-bubble">
        <div class="message-text">${content}</div>
        <span class="message-time">${time}</span>
      </div>
    `;

    messagesContainer.appendChild(div);
    scrollToBottom();
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
    
    // Envolver tablas en contenedor scrollable
    html = html.replace(/<table>/g, '<div class="table-wrapper"><table>');
    html = html.replace(/<\/table>/g, '</table></div>');
    
    return html;
  }

  function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
