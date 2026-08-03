<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

class Chatbotiagardenweb extends Module
{
    /** URL del widget (Railway). No se consulta en PHP para no bloquear el TTFB. */
    const EMBED_SCRIPT_URL = 'https://web-production-174f3.up.railway.app/embed.js';

    public function __construct()
    {
        $this->name = 'chatbotiagardenweb';
        $this->tab = 'front_office_features';
        $this->version = '1.0.1';
        $this->author = 'Huerto IA';
        $this->need_instance = 0;
        $this->ps_versions_compliancy = ['min' => '1.7.0.0', 'max' => _PS_VERSION_];

        parent::__construct();

        $this->displayName = $this->l('Chatbot IA Garden Web');
        $this->description = $this->l('Inyecta el script del chatbot IA al final de la página, sin bloquear la carga.');
    }

    public function install()
    {
        return parent::install()
            && $this->registerHook('displayFooter');
    }

    public function uninstall()
    {
        return parent::uninstall();
    }

    /**
     * Script al pie de página: defer evita bloquear el parseo del HTML.
     * El widget carga iframe y APIs solo al abrir el chat (embed.js en Railway).
     */
    public function hookDisplayFooter($params)
    {
        $url = htmlspecialchars(self::EMBED_SCRIPT_URL, ENT_QUOTES, 'UTF-8');

        return '<script defer src="' . $url . '"></script>';
    }
}
