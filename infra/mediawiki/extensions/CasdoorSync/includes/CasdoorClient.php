<?php
namespace MediaWiki\Extension\CasdoorSync;

use MediaWiki\MediaWikiServices;

class CasdoorClient {
    private string $baseUrl, $clientId, $clientSecret, $org;

    public function __construct() {
        $cfg = MediaWikiServices::getInstance()->getMainConfig();
        $this->baseUrl      = $cfg->get( 'CasdoorSyncBaseUrl' );
        $this->clientId     = $cfg->get( 'CasdoorSyncClientId' );
        $this->clientSecret = $cfg->get( 'CasdoorSyncClientSecret' );
        $this->org          = $cfg->get( 'CasdoorSyncOrg' );
    }

    private function getToken(): ?string {
        $ch = curl_init();
        curl_setopt_array( $ch, [
            CURLOPT_URL => "{$this->baseUrl}/api/login/oauth/access_token",
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query( [
                'grant_type'    => 'client_credentials',
                'client_id'     => $this->clientId,
                'client_secret' => $this->clientSecret,
            ] ),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ] );
        $data = json_decode( curl_exec( $ch ), true );
        curl_close( $ch );
        return $data['access_token'] ?? null;
    }

    public function getUserBySubject( string $subject ): ?array {
        $token = $this->getToken();
        if ( !$token ) return null;

        $ch = curl_init();
        curl_setopt_array( $ch, [
            CURLOPT_URL => "{$this->baseUrl}/api/get-user?userId={$subject}&owner={$this->org}",
            CURLOPT_HTTPHEADER => [ "Authorization: Bearer {$token}" ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ] );
        $resp = json_decode( curl_exec( $ch ), true );
        curl_close( $ch );
        return $resp['data'] ?? null;
    }

    public function getAllUsers(): array {
        $token = $this->getToken();
        if ( !$token ) return [];

        $ch = curl_init();
        curl_setopt_array( $ch, [
            CURLOPT_URL => "{$this->baseUrl}/api/get-users?owner={$this->org}",
            CURLOPT_HTTPHEADER => [ "Authorization: Bearer {$token}" ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
        ] );
        $resp = json_decode( curl_exec( $ch ), true );
        curl_close( $ch );
        return $resp['data'] ?? [];
    }
}
