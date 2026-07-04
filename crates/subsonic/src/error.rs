use thiserror::Error;

#[derive(Debug, Error)]
pub enum SubsonicError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Auth failed: {0}")]
    Auth(String),

    #[error("API error {code}: {message}")]
    Api { code: u32, message: String },

    #[error("Unexpected response: {0}")]
    Parse(String),
}
