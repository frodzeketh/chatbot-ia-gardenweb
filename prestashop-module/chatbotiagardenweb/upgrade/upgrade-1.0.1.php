<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * Migra de displayHeader (bloqueante) a displayFooter + defer en el cliente.
 */
function upgrade_module_1_0_1($module)
{
    $module->unregisterHook('displayHeader');

    return $module->registerHook('displayFooter');
}
