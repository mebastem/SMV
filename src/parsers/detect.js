export const ENGINE = {
  GOLDSRC: 'goldsrc',
  SOURCE:  'source',
  SOURCE2: 'source2',
}

const MDL_MAGIC = 0x54534449 // "IDST"

/**
 * Reads the MDL header and returns the detected engine and version.
 * Throws a descriptive Error if the file is not a recognised MDL.
 */
export function detectEngine(buffer) {
  if (buffer.byteLength < 8) throw new Error('File is too small to be a valid MDL.')

  const view    = new DataView(buffer)
  const magic   = view.getUint32(0, true)
  const version = view.getInt32(4, true)

  if (magic !== MDL_MAGIC) throw new Error('Not a valid MDL file. (Bad magic bytes — expected "IDST")')

  if (version === 10) return { engine: ENGINE.GOLDSRC, version }
  if (version >= 44 && version <= 49) return { engine: ENGINE.SOURCE, version }
  if (version >= 53) return { engine: ENGINE.SOURCE2, version }

  throw new Error(`Unrecognised MDL version: ${version}. Only GoldSrc (v10) and Source (v44–49) are supported.`)
}
