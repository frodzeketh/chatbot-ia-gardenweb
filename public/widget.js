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
    toggleBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', closeChat);
    form.addEventListener('submit', handleSubmit);
    input.addEventListener('input', handleInputChange);

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
})();
