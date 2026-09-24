#[cfg(target_os = "windows")]
pub fn system_language() -> &'static str {
    #[link(name = "Kernel32")]
    extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
    }
    // LANGID's lower ten bits identify the primary language (Chinese = 0x04).
    if (unsafe { GetUserDefaultUILanguage() } & 0x03ff) == 0x04 {
        "zh"
    } else {
        "en"
    }
}

#[cfg(not(target_os = "windows"))]
pub fn system_language() -> &'static str {
    if std::env::var("LANG").is_ok_and(|value| value.to_ascii_lowercase().starts_with("zh")) {
        "zh"
    } else {
        "en"
    }
}
