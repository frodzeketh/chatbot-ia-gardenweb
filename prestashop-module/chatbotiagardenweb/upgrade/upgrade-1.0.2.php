<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * Registra hooks extra para temas que no ejecutan displayFooter.
 */
function upgrade_module_1_0_2($module)
{
    return $module->registerHook('displayBeforeBodyClosingTag')
        && $module->registerHook('displayHeader');
}
