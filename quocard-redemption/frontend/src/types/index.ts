export interface ResultType {
    valid: boolean;
    message: string;
    code?: string; 
    storeName?: string;
    issueDate?: string;
    claimedAt?: string;
}

export interface Credentials {
    username: string;
    password: string;
}