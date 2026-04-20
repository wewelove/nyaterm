use std::io::{Cursor, Read, Write};

use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;

use crate::config::get_config_dir;
use crate::error::{AppError, AppResult};
use crate::utils::crypto::get_master_password;

const BACKUP_KEY_PREFIX: &[u8] = b"dragonfly-backup-v1:";
const BIT_ROTATE_AMOUNT: u32 = 3;

fn derive_backup_key(master_password: &str) -> Key<Aes256Gcm> {
    let mut h = Sha256::new();
    h.update(BACKUP_KEY_PREFIX);
    h.update(master_password.as_bytes());
    let digest = h.finalize();
    *Key::<Aes256Gcm>::from_slice(&digest)
}

fn rotate_left(data: &[u8]) -> Vec<u8> {
    data.iter()
        .map(|b| b.rotate_left(BIT_ROTATE_AMOUNT))
        .collect()
}

fn rotate_right(data: &[u8]) -> Vec<u8> {
    data.iter()
        .map(|b| b.rotate_right(BIT_ROTATE_AMOUNT))
        .collect()
}

pub fn export_config(app: &AppHandle, output_path: &str) -> AppResult<()> {
    let master_password = get_master_password()
        .ok_or_else(|| AppError::Config("master password is not set".into()))?;

    let config_dir = get_config_dir(app)?;

    let mut zip_buf = Cursor::new(Vec::new());
    {
        let mut zip_writer = zip::ZipWriter::new(&mut zip_buf);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        let entries = std::fs::read_dir(&config_dir)
            .map_err(|e| AppError::Config(format!("read config dir: {e}")))?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| AppError::Config("invalid file name".into()))?;

            let contents = std::fs::read(&path)?;
            zip_writer
                .start_file(file_name, options)
                .map_err(|e| AppError::Config(format!("zip write: {e}")))?;
            zip_writer.write_all(&contents)?;
        }
        zip_writer
            .finish()
            .map_err(|e| AppError::Config(format!("zip finalize: {e}")))?;
    }

    let zip_bytes = zip_buf.into_inner();
    let rotated = rotate_left(&zip_bytes);

    let key = derive_backup_key(&master_password);
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, rotated.as_ref())
        .map_err(|e| AppError::Crypto(format!("backup encryption failed: {e}")))?;

    let mut output = nonce.to_vec();
    output.extend_from_slice(&ciphertext);
    std::fs::write(output_path, &output)?;

    Ok(())
}

pub fn import_config(app: &AppHandle, file_path: &str) -> AppResult<()> {
    let master_password = get_master_password()
        .ok_or_else(|| AppError::Config("master password is not set".into()))?;

    let raw = std::fs::read(file_path)?;
    if raw.len() < 13 {
        return Err(AppError::Crypto("backup file is too short".into()));
    }

    let (nonce_bytes, ciphertext) = raw.split_at(12);
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);

    let key = derive_backup_key(&master_password);
    let cipher = Aes256Gcm::new(&key);
    let rotated = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Crypto(format!("backup decryption failed: {e}")))?;

    let zip_bytes = rotate_right(&rotated);

    let config_dir = get_config_dir(app)?;

    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| AppError::Config(format!("invalid backup archive: {e}")))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| AppError::Config(format!("read archive entry: {e}")))?;

        if file.is_dir() {
            continue;
        }

        let Some(name) = file.enclosed_name().map(|p| p.to_owned()) else {
            continue;
        };

        let out_path = config_dir.join(&name);
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        std::fs::write(&out_path, &buf)?;
    }

    // Reload the master password from the restored settings
    if let Ok(settings) = crate::config::load_app_settings(app) {
        if let Some(ref ct) = settings.security.master_password {
            if let Ok(plain) = crate::utils::crypto::decrypt_settings_secret(ct) {
                crate::utils::crypto::set_master_password(Some(plain));
            }
        }
    }

    Ok(())
}
