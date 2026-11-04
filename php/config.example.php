<?php
// Copiez ce fichier en config.php puis renseignez vos accès MySQL.
// Utilisez une longue clé aléatoire privée pour JWT_SECRET.
return [
    'DB_HOST' => 'localhost',
    'DB_PORT' => 3306,
    'DB_NAME' => 'fileweb',
    'DB_USER' => 'votre_utilisateur_mysql',
    'DB_PASSWORD' => 'votre_mot_de_passe_mysql',
    'JWT_SECRET' => 'REMPLACEZ_PAR_UNE_CLE_ALEATOIRE_LONGUE_ET_UNIQUE',
    'MAX_UPLOAD_BYTES' => 104857600,
    'MAX_UNZIP_BYTES' => 524288000,
    'RESET_ROOT' => false,
];
