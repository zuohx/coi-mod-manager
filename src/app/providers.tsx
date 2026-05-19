import React, { ReactNode } from 'react'

type ProvidersProps = {
  children: ReactNode
}

function Providers({ children }: ProvidersProps) {
  return <>{children}</>
}

export default Providers
