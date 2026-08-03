<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

class Chatbotiagardenweb extends Module
{
    const EMBED_SCRIPT_URL = 'https://web-production-174f3.up.railway.app/embed.js';

    /** Evita inyectar el script dos veces si varios hooks se ejecutan en la misma pagina. */
    private static $scriptInjected = false;

    public function __construct()
    {
        $this->name = 'chatbotiagardenweb';
        $this->tab = 'front_office_features';
        $this->version = '1.0.2';
        $this->author = 'Huerto IA';
        $this->need_instance = 0;
        $this->ps_versions_compliancy = ['min' => '1.7.0.0', 'max' => _PS_VERSION_];

        parent::__construct();

        $this->displayName = $this->l('Chatbot IA Garden Web');
        $this->description = $this->l('Inyecta el script del chatbot IA sin bloquear la carga de la tienda.');
    }

    public function install()
    {
        return parent::install()
            && $this->registerHook('displayBeforeBodyClosingTag')
            && $this->registerHook('displayFooter')
            && $this->registerHook('displayHeader');
    }

    public function uninstall()
    {
        return parent::uninstall();
    }

    /**
     * Varios hooks por compatibilidad con temas custom (algunos no llaman displayFooter).
     * defer: no bloquea el parseo aunque el hook sea displayHeader.
     */
    private function renderEmbedScript()
    {
        if (self::$scriptInjected) {
            return '';
        }

        self::$scriptInjected = true;

        $url = htmlspecialchars(self::EMBED_SCRIPT_URL, ENT_QUOTES, 'UTF-8');

        return '<script defer src="' . $url . '" data-chatbot-embed="1"></script>';
    }

    public function hookDisplayBeforeBodyClosingTag($params)
    {
        return $this->renderEmbedScript();
    }

    public function hookDisplayFooter($params)
    {
        return $this->renderEmbedScript();
    }

    public function hookDisplayHeader($params)
    {
        return $this->renderEmbedScript();
    }
}
