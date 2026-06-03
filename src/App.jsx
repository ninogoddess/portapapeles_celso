import React, { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabase } from './supabase'

// ── Nota individual sortable ──────────────────────────────────────────────────
function NoteCard({ note, onDelete, onCopy, onChange, isNew, isDeleting, isCopied }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: note.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 999 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'note',
        isNew ? 'note-enter' : '',
        isDeleting ? 'note-exit' : '',
      ].join(' ').trim()}
    >
      <div className="drag-handle" {...attributes} {...listeners} title="Arrastrar">
        ⠿
      </div>
      <textarea
        value={note.content}
        onChange={(e) => onChange(note.id, e.target.value)}
        placeholder="Escribe algo..."
        rows={4}
      />
      <div className="note-actions">
        <button
          className="btn-copy"
          onClick={() => onCopy(note.id, note.content)}
          title="Copiar"
        >
          {isCopied ? <span className="tick">✓ Copiado</span> : '📄 Copiar'}
        </button>
        <button
          className="btn-delete"
          onClick={() => onDelete(note.id)}
          title="Borrar"
        >
          🗑 Borrar
        </button>
      </div>
    </div>
  )
}

// ── App principal ─────────────────────────────────────────────────────────────
export default function App() {
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [newIds, setNewIds] = useState(new Set())
  const debounceTimers = useRef({})
  const editingIds = useRef(new Set())
  // Flag para ignorar updates de Realtime mientras arrastramos
  const isDraggingRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  )

  useEffect(() => {
    async function fetchNotes() {
      const { data } = await supabase
        .from('notes')
        .select('*')
        .order('position', { ascending: true })
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
              const next = [payload.new, ...prev]
              return next.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            })
            setNewIds((prev) => new Set(prev).add(payload.new.id))
            setTimeout(() => {
              setNewIds((prev) => {
                const next = new Set(prev)
                next.delete(payload.new.id)
                return next
              })
            }, 500)
          } else if (payload.eventType === 'UPDATE') {
            setNotes((prev) => {
              const updated = prev.map((n) =>
                n.id === payload.new.id
                  ? {
                      ...n,
                      // Solo actualizar content si no lo está editando el usuario local
                      content: editingIds.current.has(n.id) ? n.content : payload.new.content,
                      position: payload.new.position,
                    }
                  : n
              )
              // Si cambió position de alguna nota y no estamos arrastrando, reordenar
              if (!isDraggingRef.current) {
                return updated.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
              }
              return updated
            })
          } else if (payload.eventType === 'DELETE') {
            setNotes((prev) => prev.filter((n) => n.id !== payload.old.id))
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  async function addNote() {
    const minPos = notes.length > 0 ? Math.min(...notes.map((n) => n.position ?? 0)) : 0
    const { error } = await supabase
      .from('notes')
      .insert({ content: '', position: minPos - 1000 })
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

  function handleDragStart() {
    isDraggingRef.current = true
  }

  async function handleDragEnd(event) {
    isDraggingRef.current = false
    const { active, over } = event
    if (!over || active.id === over.id) return

    setNotes((prev) => {
      const oldIndex = prev.findIndex((n) => n.id === active.id)
      const newIndex = prev.findIndex((n) => n.id === over.id)
      const reordered = arrayMove(prev, oldIndex, newIndex)
      const withPositions = reordered.map((note, i) => ({ ...note, position: i * 1000 }))

      // Persistir cada posición en Supabase — Realtime lo propagará a todos
      withPositions.forEach((note) => {
        supabase.from('notes').update({ position: note.position }).eq('id', note.id)
      })

      return withPositions
    })
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={notes.map((n) => n.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="notes">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                isNew={newIds.has(note.id)}
                isDeleting={deletingId === note.id}
                isCopied={copiedId === note.id}
                onChange={handleChange}
                onDelete={deleteNote}
                onCopy={copyNote}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
