import { useEffect } from 'react'

/**
 * React shell for the Telecast engine. The engine (src/telecast) renders imperatively into
 * #app, so it is loaded only after this element is mounted.
 */
function App() {
  useEffect(() => {
    import('./telecast/main.js').then((m) => m.startTelecast())
  }, [])

  return <div id="app" />
}

export default App
