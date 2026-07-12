import { createClient } from '@supabase/supabase-js'
import { mockEvents } from '../utils/mockData'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Initialize local storage database fallbacks
const initLocalDb = () => {
  if (!localStorage.getItem('eh_events')) {
    localStorage.setItem('eh_events', JSON.stringify(mockEvents))
  }
  if (!localStorage.getItem('eh_registrations')) {
    localStorage.setItem('eh_registrations', JSON.stringify([]))
  }
}
initLocalDb()

const getLocalEvents = () => {
  try {
    return JSON.parse(localStorage.getItem('eh_events') || '[]')
  } catch {
    return mockEvents
  }
}

const saveLocalEvents = (events) => {
  localStorage.setItem('eh_events', JSON.stringify(events))
}

const getLocalRegistrations = () => {
  try {
    return JSON.parse(localStorage.getItem('eh_registrations') || '[]')
  } catch {
    return []
  }
}

const saveLocalRegistrations = (registrations) => {
  localStorage.setItem('eh_registrations', JSON.stringify(registrations))
}

// ══════════ EVENTS DATABASE & LOCAL FALLBACKS ══════════

export const getEvents = async (filters = {}) => {
  try {
    let query = supabase.from('events').select('*').order('date', { ascending: true })
    if (filters.category && filters.category !== 'All') {
      query = query.eq('category', filters.category)
    }
    if (filters.search) {
      query = query.or(`title.ilike.%${filters.search}%,venue.ilike.%${filters.search}%`)
    }
    const { data, error } = await query
    if (error) throw error
    if (data && data.length > 0) {
      // Sync local storage with database if online data exists
      saveLocalEvents(data)
      return data
    }
  } catch (err) {
    console.warn('Supabase getEvents failed, loading from localStorage:', err)
  }

  // Fallback to localStorage
  let localEvents = getLocalEvents()
  if (filters.category && filters.category !== 'All') {
    localEvents = localEvents.filter(e => e.category === filters.category)
  }
  if (filters.search) {
    const searchLower = filters.search.toLowerCase()
    localEvents = localEvents.filter(e => 
      e.title.toLowerCase().includes(searchLower) || 
      e.venue.toLowerCase().includes(searchLower)
    )
  }
  return localEvents.sort((a, b) => new Date(a.date) - new Date(b.date))
}

export const getEventById = async (id) => {
  try {
    const { data, error } = await supabase.from('events').select('*').eq('id', id).single()
    if (error) throw error
    return data
  } catch (err) {
    console.warn('Supabase getEventById failed, loading from localStorage:', err)
    const localEvents = getLocalEvents()
    return localEvents.find(e => String(e.id) === String(id)) || null
  }
}

export const createEvent = async (eventData) => {
  const newEventId = Date.now().toString()
  const newEvent = { ...eventData, id: newEventId }

  // Persist locally first
  const localEvents = getLocalEvents()
  localEvents.push(newEvent)
  saveLocalEvents(localEvents)

  try {
    const { data, error } = await supabase.from('events').insert([eventData]).select()
    if (error) throw error
    return data[0]
  } catch (err) {
    console.warn('Supabase createEvent failed, saved to localStorage:', err)
    return newEvent
  }
}

export const updateEvent = async (id, eventData) => {
  // Update locally first
  const localEvents = getLocalEvents()
  const index = localEvents.findIndex(e => String(e.id) === String(id))
  if (index !== -1) {
    localEvents[index] = { ...localEvents[index], ...eventData }
    saveLocalEvents(localEvents)
  }

  try {
    const { data, error } = await supabase.from('events').update(eventData).eq('id', id).select()
    if (error) throw error
    return data[0]
  } catch (err) {
    console.warn('Supabase updateEvent failed, updated locally in localStorage:', err)
    return { ...eventData, id }
  }
}

export const deleteEvent = async (id) => {
  // Delete locally first
  const localEvents = getLocalEvents()
  const filtered = localEvents.filter(e => String(e.id) !== String(id))
  saveLocalEvents(filtered)

  try {
    const { error } = await supabase.from('events').delete().eq('id', id)
    if (error) throw error
  } catch (err) {
    console.warn('Supabase deleteEvent failed, deleted locally from localStorage:', err)
  }
}

// ══════════ REGISTRATIONS DATABASE & LOCAL FALLBACKS ══════════

export const createRegistration = async (registrationData) => {
  const regId = `REG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
  const newReg = { 
    ...registrationData, 
    registration_id: regId, 
    id: Date.now(), 
    created_at: new Date().toISOString() 
  }

  // Persist locally first
  const localRegs = getLocalRegistrations()
  localRegs.push(newReg)
  saveLocalRegistrations(localRegs)

  try {
    const { data, error } = await supabase
      .from('registrations')
      .insert([{ ...registrationData, registration_id: regId }])
      .select()
    if (error) throw error
    return data[0]
  } catch (err) {
    console.warn('Supabase createRegistration failed, saved to localStorage:', err)
    return newReg
  }
}

export const getRegistrations = async (eventId = null) => {
  try {
    let query = supabase
      .from('registrations')
      .select('*, events(title, date, venue)')
      .order('created_at', { ascending: false })
    if (eventId) query = query.eq('event_id', eventId)
    const { data, error } = await query
    if (error) throw error
    if (data && data.length > 0) {
      saveLocalRegistrations(data)
      return data
    }
  } catch (err) {
    console.warn('Supabase getRegistrations failed, loading from localStorage:', err)
  }

  // Fallback to localStorage
  const localRegs = getLocalRegistrations()
  const localEvents = getLocalEvents()

  // Map event details onto registration objects (like the Supabase relational select)
  const mappedRegs = localRegs.map(reg => {
    const ev = localEvents.find(e => String(e.id) === String(reg.event_id))
    return {
      ...reg,
      events: ev ? { title: ev.title, date: ev.date, venue: ev.venue } : null
    }
  })

  if (eventId) {
    return mappedRegs.filter(r => String(r.event_id) === String(eventId))
  }
  return mappedRegs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

export const checkExistingRegistration = async (eventId, email) => {
  try {
    const { data } = await supabase
      .from('registrations')
      .select('id')
      .eq('event_id', eventId)
      .eq('email', email)
    if (data && data.length > 0) return true
  } catch (err) {
    console.warn('Supabase checkExistingRegistration failed, loading from localStorage:', err)
  }

  const localRegs = getLocalRegistrations()
  return localRegs.some(r => String(r.event_id) === String(eventId) && r.email === email)
}
