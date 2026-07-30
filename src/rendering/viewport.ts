export const DISPLAY = {
  width: 1920,
  height: 1080,
  aspect: 16 / 9,
} as const

export type StageLayout = {
  scale: number
  left: number
  top: number
  width: number
  height: number
}

/** Fits the fixed 1920×1080 game stage inside the browser without cropping. */
export function fitStage(viewportWidth: number, viewportHeight: number): StageLayout {
  const safeWidth = Math.max(1, viewportWidth)
  const safeHeight = Math.max(1, viewportHeight)
  const scale = Math.min(safeWidth / DISPLAY.width, safeHeight / DISPLAY.height)
  const width = DISPLAY.width * scale
  const height = DISPLAY.height * scale

  return {
    scale,
    left: (safeWidth - width) / 2,
    top: (safeHeight - height) / 2,
    width,
    height,
  }
}
