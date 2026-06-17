//! Shared terminal input helpers.

/// Replace DEL (0x7F) with BS (0x08) in-place.
pub(crate) fn remap_del_to_bs(data: &mut [u8]) {
    for byte in data.iter_mut() {
        if *byte == 0x7f {
            *byte = 0x08;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::remap_del_to_bs;

    #[test]
    fn remaps_del_to_bs_without_changing_other_bytes() {
        let mut data = b"a\x7fb\x08c\x7f".to_vec();

        remap_del_to_bs(&mut data);

        assert_eq!(data, b"a\x08b\x08c\x08");
    }
}
