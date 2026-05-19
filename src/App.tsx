import React from 'react'
import { ModStatusPage } from '@/features/mod-status/ui/ModStatusPage'
import './App.css'

function App() {
  return (
    <div className="App">
      {/* <header className="App-header">
        <h1>COI Mod Status Report</h1>
        <p>Captain of Industry Mod 状态报告工具</p>
      </header> */}
      <ModStatusPage />
    </div>
  )
}

export default App
