import { createContext, useContext, useState } from 'react'

const ProjetActifContext = createContext(null)

export function ProjetActifProvider({ children }) {
  const [demandeId, setDemandeId] = useState('')
  const [clientNom, setClientNom] = useState('')

  function definirProjetActif(id, nom) {
    setDemandeId(id)
    setClientNom(nom || '')
  }

  return (
    <ProjetActifContext.Provider value={{ demandeId, clientNom, definirProjetActif }}>
      {children}
    </ProjetActifContext.Provider>
  )
}

export function useProjetActif() {
  return useContext(ProjetActifContext)
}
