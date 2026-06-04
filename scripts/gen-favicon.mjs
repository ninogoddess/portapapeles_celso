import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'

const size = 180

// Máscara circular
const circle = Buffer.from(
  `<svg><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></svg>`
)

await sharp('public/logo_principal.jpg')
  .resize(size, size)
  .composite([{ input: circle, blend: 'dest-in' }])
  .png()
  .toFile('public/favicon.png')

console.log('favicon.png generado')
