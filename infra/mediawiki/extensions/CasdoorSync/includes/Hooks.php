<?php
namespace MediaWiki\Extension\CasdoorSync;

use JobQueueGroup;
use JobSpecification;
use MediaWiki\MediaWikiServices;
use MediaWiki\User\User;
use Title;

class Hooks {
    public static function onUserLoggedIn( User $user ) {
        $dbr = wfGetDB( DB_REPLICA );
        $row = $dbr->selectRow(
            'openid_connect',
            [ 'oidc_subject' ],
            [ 'oidc_user' => $user->getId() ],
            __METHOD__
        );
        if ( !$row || !$row->oidc_subject ) {
            return; // not an OIDC-linked account
        }

        $job = new JobSpecification(
            'casdoorSync',
            [ 'mode' => 'single', 'userId' => $user->getId(), 'subject' => $row->oidc_subject ],
            [],
            Title::newMainPage()
        );
        MediaWikiServices::getInstance()->getJobQueueGroup()->push( $job );
    }
}
