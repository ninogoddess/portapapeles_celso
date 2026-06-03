import React, { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export default function App() {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [newIds, setNewIds] = useState(new Set())
  const debounceTimers = useRef({})
  const editingIds = useRef(new Set())

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

    const channel = supabase
      .channel('notes-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setNotes((prev) => {
              if (prev.some((n) => n.id === payload.new.id)) return prev
              return [...prev, payload.new]
            })
            // Marcar como nueva para animación de entrada
            setNewIds((prev) => new Set(prev).add(payload.new.id))
            setTimeout(() => {
              setNewIds((prev) => {
                const next = new Set(prev)
                next.delete(payload.new.id)
                return next
              })
            }, 500)
          } else if (payload.eventType === 'UPDATE') {
            if (editingIds.current.has(payload.new.id)) return
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

  async function addNote() {
    const { error } = await supabase.from('notes').insert({ content: '' })
    if (error) console.error('Error al insertar:', error)
  }

  function handleChange(id, value) {
    editingIds.current.add(id)
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, content: value } : n))
    )
    clearTimeout(debounceTimers.current[id])
    debounceTimers.current[id] = setTimeout(async () => {
      await supabase.from('notes').update({ content: value }).eq('id', id)
      editingIds.current.delete(id)
    }, 800)
  }

  async function deleteNote(id) {
    clearTimeout(debounceTimers.current[id])
    editingIds.current.delete(id)
    // Animar salida, luego borrar
    setDeletingId(id)
    setTimeout(async () => {
      await supabase.from('notes').delete().eq('id', id)
      setDeletingId(null)
    }, 350)
  }

  async function copyNote(id, content) {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      const el = document.createElement('textarea')
      el.value = content
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1200)
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
          <div
            className={[
              'note',
              newIds.has(note.id) ? 'note-enter' : '',
              deletingId === note.id ? 'note-exit' : '',
            ].join(' ').trim()}
            key={note.id}
          >
            <textarea
              value={note.content}
              onChange={(e) => handleChange(note.id, e.target.value)}
              placeholder="Escribe algo..."
              rows={4}
            />
            <div className="note-actions">
              <button
                className="btn-copy"
                onClick={() => copyNote(note.id, note.content)}
                title="Copiar"
              >
                {copiedId === note.id ? (
                  <span className="tick">✓ Copiado</span>
                ) : (
                  '📄 Copiar'
                )}
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
