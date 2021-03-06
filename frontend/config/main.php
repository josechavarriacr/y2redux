<?php

$params = array_merge(
    require(__DIR__ . '/../../common/config/params.php'),
    require(__DIR__ . '/../../common/config/params-local.php'),
    require(__DIR__ . '/params.php'),
    require(__DIR__ . '/params-local.php')
);

return [
    'id' => 'app-frontend',
    'basePath' => dirname(__DIR__),
    'bootstrap' => ['log'],
    'controllerNamespace' => 'frontend\controllers',
    'modules' => [
        'api' => 'frontend\modules\api\Module'
    ],
    'components' => [
        'view' => [
            'as state' => [
                'class' => 'frontend\behaviors\InitialStateBehavior',
                'initialState' => function () {
                    // the state tree into which we merge additional values specific to the requested action
                    return [
                        'routing' => [
                            'location' => [
                                'pathname' => ltrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/'),
                            ]
                        ],
                        'user' => Yii::$app->user->isGuest
                            ? null
                            : Yii::$app->user->identity->getAttributes(['id', 'username'])
                    ];
                }
            ]
        ],
        'request' => [
            'parsers' => [
                'application/json' => 'yii\web\JsonParser',
            ]
        ],
        'errorHandler' => [
            'errorAction' => 'default/error',
        ],
        'session' => ['class' => 'yii\web\DbSession'],
        'user' => [
            'identityClass' => 'common\models\User',
            'enableAutoLogin' => true,
        ],
        'urlManager' => [
            'class' => 'yii\web\UrlManager',
            'enableStrictParsing' => true,
            'enablePrettyUrl' => true,
            'showScriptName' => false,
            'rules' => require(__DIR__ . '/rules.php')
        ],
    ],
    'params' => $params
];
