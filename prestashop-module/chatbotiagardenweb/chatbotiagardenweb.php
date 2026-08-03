<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

class Chatbotiagardenweb extends Module
{
    const EMBED_SCRIPT_URL = 'https://web-production-174f3.up.railway.app/embed.js';

    public function __construct()
    {
        $this->name = 'chatbotiagardenweb';
        $this->tab = 'front_office_features';
        $this->version = '1.0.3';
        $this->author = 'Huerto IA';
        $this->need_instance = 0;
        $this->ps_versions_compliancy = ['min' => '1.7.0.0', 'max' => _PS_VERSION_];

        parent::__construct();

        $this->displayName = $this->l('Chatbot IA Garden Web');
        $this->description = $this->l('Chatbot IA: carga diferida tras la pagina, sin afectar el tiempo de inicio.');
    }

    public function install()
    {
        return parent::install()
            && $this->registerHook('actionFrontControllerSetMedia');
    }

    public function uninstall()
    {
        return parent::uninstall();
    }

    /**
     * Registra un loader local (~400 B). embed.js de Railway solo se pide
     * despues de window.load + idle, sin competir con la carga inicial.
     */
    public function hookActionFrontControllerSetMedia($params)
    {
        if (!isset($this->context->controller)) {
            return;
        }

        $this->context->controller->registerJavascript(
            'module-' . $this->name . '-loader',
            'modules/' . $this->name . '/views/js/chatbot-loader.js',
            [
                'position' => 'bottom',
                'priority' => 200,
                'version' => $this->version,
            ]
        );
    }
}
