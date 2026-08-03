<?php

if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * Quita hooks del header/footer y usa carga diferida (SetMedia + loader local).
 */
function upgrade_module_1_0_3($module)
{
    $module->unregisterHook('displayHeader');
    $module->unregisterHook('displayFooter');
    $module->unregisterHook('displayBeforeBodyClosingTag');

    return $module->registerHook('actionFrontControllerSetMedia');
}
