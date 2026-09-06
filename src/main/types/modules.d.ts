declare module 'ffmpeg-static' {
  const path: string | null
  export default path
}

/**
 * Microsoft's jxrlib compiled to WebAssembly (decode only). The factory
 * resolves once the module is instantiated; the wasm is inlined in the JS, so
 * nothing is read from disk and the package can live inside the asar.
 */
declare module 'jpegxr' {
  interface JpegXrPixelInfo {
    channels: number
    colorFormat: string
    bitDepth: string
    bitsPerPixel: number
    hasAlpha: boolean
    premultipledAlpha: boolean
    bgr: boolean
  }
  interface JpegXrImage {
    width: number
    height: number
    pixelInfo: JpegXrPixelInfo
    bytes: Uint8Array
  }
  interface JpegXrCodec {
    decode(bytes: Uint8Array): JpegXrImage
  }
  const factory: () => Promise<JpegXrCodec>
  export default factory
}
