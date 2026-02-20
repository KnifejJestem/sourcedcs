import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync } from 'fs'
import { resolve } from 'path'

// Plugin: copy legacy map JS files into dist/js/ after build
function copyMapPlugin() {
  return {
    name: 'copy-map-js',
    closeBundle() {
      cpSync(resolve(__dirname, 'js'), resolve(__dirname, 'dist/js'), { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), copyMapPlugin()],
})
