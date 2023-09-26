export interface LoginResponse {
    iss: string;
    azp: string;
    aud: string;
    sub: string;
    nbf: number;
    exp: number;
    iat: number;
    jti: string;
    nonce: string;
}

export interface LoginData {
    randomness: string;
    nonce: string;
    ephemeralPublicKey: string;
}


export interface PersistentData {
    nonce: string;
    ephemeralPublicKey: string;
    salt: string;
}