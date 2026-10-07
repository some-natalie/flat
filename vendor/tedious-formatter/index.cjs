// Only Tedious's fixed diagnostic formats are supported, not general printf.
// Unsupported specifiers remain literal; precision never reaches Number methods.
function sprintf(format, ...args) {
  let index = 0
  return format.replace(
    /%%|%(0)?(\d+)?([dsxX])/g,
    (placeholder, zero, rawWidth, type) => {
      if (placeholder === '%%') return '%'
      const width = Number(rawWidth ?? 0)
      if (!Number.isSafeInteger(width) || width > 32) return placeholder
      const value = args[index++]
      let text
      if (type === 's') {
        text = String(value)
      } else if (type === 'd') {
        text = String(Number.parseInt(value, 10))
      } else {
        text = (Number.parseInt(value, 10) >>> 0).toString(16)
        if (type === 'X') text = text.toUpperCase()
      }
      if (zero && text.startsWith('-')) {
        return '-' + text.slice(1).padStart(Math.max(0, width - 1), '0')
      }
      return text.padStart(width, zero ? '0' : ' ')
    },
  )
}

module.exports = { sprintf }
