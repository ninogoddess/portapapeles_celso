import React, { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export default function App() {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const debounceTimers = useRef({})

  // Carga inicial
  useEffect(() => {
    async function fetchNotes() {
      const { data } = await supabase
        .from('notes')
        .select('*')
        .order('created_at', { ascending: true })
      setNotes(data || [])
      setLoading(false)
    }
    fetchNotes()

    // Suscripción en tiempo real
    const channel = supabase
      .channel('notes-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setNotes((prev) => [...prev, payload.new])
          } else if (payload.eventType === 'UPDATE') {
            setNotes((prev) =>
              prev.map((n) => (n.id === payload.new.id ? payload.new : n))
            )
          } else if (payload.eventType === 'DELETE') {
            setNotes((prev) => prev.filter((n) => n.id !== payload.old.id))
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  // Agregar nota nueva — optimista: aparece local de inmediato
  async function addNote() {
    const { data, error } = await supabase
      .from('notes')
      .insert({ content: '' })
      .select()
      .single()
    if (error) {
      console.error('Error al insertar:', error)
      return
    }
    // Si Realtime no la trae sola, la agregamos manualmente
    setNotes((prev) => {
      const yaExiste = prev.some((n) => n.id === data.id)
      return yaExiste ? prev : [...prev, data]
    })
  }

  // Editar con debounce: actualiza local inmediato, guarda en Supabase al dejar de escribir
  function handleChange(id, value) {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, content: value } : n))
    )
    clearTimeout(debounceTimers.current[id])
    debounceTimers.current[id] = setTimeout(async () => {
      await supabase.from('notes').update({ content: value }).eq('id', id)
    }, 800)
  }

  // Borrar nota
  async function deleteNote(id) {
    clearTimeout(debounceTimers.current[id])
    await supabase.from('notes').delete().eq('id', id)
  }

  // Copiar al portapapeles del sistema
  async function copyNote(content) {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      // fallback para navegadores sin permiso
      const el = document.createElement('textarea')
      el.value = content
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
  }

  if (loading) return <div className="center">Cargando...</div>

  return (
    <div className="container">
      <header>
        <h1>📋 Portapapeles</h1>
        <button className="btn-add" onClick={addNote}>+ Nueva nota</button>
      </header>

      {notes.length === 0 && (
        <p className="empty">No hay notas aún. Agrega una.</p>
      )}

      <div className="notes">
        {notes.map((note) => (
          <div className="note" key={note.id}>
            <textarea
              value={note.content}
              onChange={(e) => handleChange(note.id, e.target.value)}
              placeholder="Escribe algo..."
              rows={4}
            />
            <div className="note-actions">
              <button
                className="btn-copy"
                onClick={() => copyNote(note.content)}
                title="Copiar"
              >
                📄 Copiar
              </button>
              <button
                className="btn-delete"
                onClick={() => deleteNote(note.id)}
                title="Borrar"
              >
                🗑 Borrar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
