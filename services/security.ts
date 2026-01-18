
/**
 * Security Utilities for Lumina
 * Handles client-side obfuscation of user-provided API keys stored in the Vault.
 * 
 * NOTE: This is client-side obfuscation (XOR cipher), not military-grade encryption.
 * It protects keys from casual browsing but not determined attacks on the local machine.
 */

const CIPHER_SALT = 'LUMINA_NEURAL_CORE_v1';

/**
 * Encrypts a string using a salt-based XOR cipher and Base64 encoding.
 */
export const encryptValue = (text: string): string => {
  const textChars = text.split('').map(c => c.charCodeAt(0));
  const saltChars = CIPHER_SALT.split('').map(c => c.charCodeAt(0));
  const encrypted = textChars.map((char, i) => 
    char ^ saltChars[i % saltChars.length]
  );
  return btoa(String.fromCharCode(...encrypted));
};

/**
 * Decrypts a Base64 encoded XOR cipher string.
 */
export const decryptValue = (cipher: string): string => {
  try {
    const raw = atob(cipher);
    const rawChars = raw.split('').map(c => c.charCodeAt(0));
    const saltChars = CIPHER_SALT.split('').map(c => c.charCodeAt(0));
    const decrypted = rawChars.map((char, i) => 
      char ^ saltChars[i % saltChars.length]
    );
    return String.fromCharCode(...decrypted);
  } catch (e) { 
    console.warn("Failed to decrypt value");
    return ''; 
  }
};

/**
 * Retrieves the active API key. 
 * Priority: 
 * 1. User-selected key from LocalStorage Vault
 * 2. Environment Variable (process.env.API_KEY)
 */
export const getActiveApiKey = (): string => {
  try {
    const activeId = localStorage.getItem('lumina_active_key_id');
    const vault = localStorage.getItem('lumina_vault');
    if (activeId && vault) {
      const keys = JSON.parse(vault);
      const activeKey = keys.find((k: any) => k.id === activeId);
      if (activeKey) {
        return decryptValue(activeKey.value);
      }
    }
  } catch (e) {
    console.error("Failed to retrieve vault key", e);
  }
  
  // Fallback to environment variable provided by build/hosting environment
  return process.env.API_KEY || '';
};
