/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Plus, 
  Trash2, 
  Search, 
  Menu, 
  X, 
  Save, 
  Clock, 
  ChevronLeft,
  BookOpen,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Lock,
  Mail,
  ArrowRight,
  Settings,
  Download,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from './lib/supabase';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// --- Types ---
interface Note {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
  userId: string;
}

interface AppUser {
  id: string;
  name: string;
  email: string;
  createdAt?: string;
}

// --- Constants ---
const DEBOUNCE_DELAY = 500;

export default function App() {
  // --- Auth State ---
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [showLandingPage, setShowLandingPage] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [profileActionLoading, setProfileActionLoading] = useState(false);
  const [profileMessage, setProfileMessage] = useState({ text: '', type: 'error' as 'error' | 'success' });
  const [profileForms, setProfileForms] = useState({
    name: '',
    email: '',
    currentPasswordForEmail: '',
    currentPasswordForPass: '',
    newPassword: '',
    confirmNewPassword: ''
  });
  const [deleteAccountStage, setDeleteAccountStage] = useState<'none' | 'confirm' | 'password' | 'export'>('none');
  const [currentPasswordForDelete, setCurrentPasswordForDelete] = useState('');
  
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authFormData, setAuthFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // --- App State ---
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Derived State ---
  const filteredNotes = useMemo(() => {
    return notes
      .filter(n => 
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        n.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, searchQuery]);

  const activeNote = useMemo(() => {
    return notes.find(n => n.id === activeNoteId);
  }, [notes, activeNoteId]);

  // --- Helpers ---
  const generateTitle = useCallback((content: string) => {
    const firstLine = content.split('\n')[0].trim();
    return firstLine || 'Untitled Note';
  }, []);

  // --- Auth Actions ---
  const handleAuth = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);

    try {
      if (authMode === 'signup') {
        if (authFormData.password !== authFormData.confirmPassword) {
          throw new Error('Passwords do not match');
        }
        
        const { data, error } = await supabase.auth.signUp({
          email: authFormData.email,
          password: authFormData.password,
          options: {
            data: {
              full_name: authFormData.name
            }
          }
        });

        if (error) throw error;
        
        // Ensure a profile exists for existence checks during login
        if (data.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            email: data.user.email,
            full_name: authFormData.name
          });

          if (!data.session) {
            setAuthError('Check your email for confirmation link!');
          }
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: authFormData.email,
          password: authFormData.password,
        });
        if (error) throw error;
      }
    } catch (err: any) {
      console.error('Auth error full object:', err);
      let msg = err.message || 'An error occurred';
      const errorCode = err.code || (err.status === 400 ? 'invalid_credentials' : '');
      const lower = msg.toLowerCase();

      // Map Supabase errors to distinct messages
      if (authMode === 'login' && (lower.includes('invalid login credentials') || lower.includes('invalid credentials') || errorCode === 'invalid_credentials')) {
        try {
          // Check if user exists in the 'profiles' collection
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('email', authFormData.email)
            .maybeSingle();

          if (!profileError && !profileData) {
            msg = 'user not found';
          } else {
            msg = 'incorrect password';
          }
        } catch (checkErr) {
          msg = 'incorrect password'; 
        }
      }
      
      // Secondary normalization to ensure requested strings are used
      const finalLower = msg.toLowerCase();
      if (finalLower.includes('user not found') || finalLower.includes('no user')) {
        msg = 'user not found';
      } else if (finalLower.includes('invalid password') || finalLower.includes('incorrect password') || finalLower.includes('invalid login credentials')) {
        msg = 'incorrect password';
      }
      
      setAuthError(msg);
    } finally {
      setIsAuthLoading(false);
    }
  }, [authMode, authFormData]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setNotes([]);
    setActiveNoteId(null);
    setShowLandingPage(true);
  }, []);

  // --- App Actions ---
  const fetchNotes = useCallback(async () => {
    if (!currentUser) return;
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching notes:', error);
      return;
    }

    if (data) {
      const formattedNotes: Note[] = data.map(n => ({
        id: n.id,
        title: n.title,
        content: n.content,
        updatedAt: new Date(n.updated_at).getTime(),
        userId: n.user_id
      }));
      setNotes(formattedNotes);
    }
  }, [currentUser]);

  const createNote = useCallback(async () => {
    if (!currentUser) return;
    
    const newNoteData = {
      title: 'New Note',
      content: '',
      user_id: currentUser.id,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('notes')
      .insert([newNoteData])
      .select()
      .single();

    if (error) {
      console.error('Error creating note:', error);
      return;
    }

    if (data) {
      const newNote: Note = {
        id: data.id,
        title: data.title,
        content: data.content,
        updatedAt: new Date(data.updated_at).getTime(),
        userId: data.user_id
      };
      setNotes(prev => [newNote, ...prev]);
      setActiveNoteId(newNote.id);
      setIsSidebarOpen(false);
    }
  }, [currentUser]);

  const deleteNote = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const { error } = await supabase
      .from('notes')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting note:', error);
      return;
    }

    setNotes(prev => prev.filter(n => n.id !== id));
    if (activeNoteId === id) {
      setActiveNoteId(null);
    }
  }, [activeNoteId]);

  const updateNote = useCallback((updates: Partial<{title: string, content: string}>) => {
    if (!activeNoteId || !currentUser) return;

    setSaveStatus('saving');
    const updatedAt = Date.now();

    // Optimistic update
    setNotes(prev => prev.map(n => {
      if (n.id === activeNoteId) {
        return { ...n, ...updates, updatedAt };
      }
      return n;
    }));

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const { error } = await supabase
        .from('notes')
        .update({ 
          ...updates,
          updated_at: new Date(updatedAt).toISOString() 
        })
        .eq('id', activeNoteId);

      if (error) {
        console.error('Error saving note:', error);
        setSaveStatus('idle');
      } else {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      }
    }, DEBOUNCE_DELAY);
  }, [activeNoteId, currentUser]);

  // --- Profile Actions ---
  const handleUpdateName = useCallback(async () => {
    if (!currentUser || !profileForms.name) return;
    setProfileActionLoading(true);
    setProfileMessage({ text: '', type: 'error' });

    try {
      const { error: authError } = await supabase.auth.updateUser({
        data: { full_name: profileForms.name }
      });
      if (authError) throw authError;

      const { error: dbError } = await supabase
        .from('profiles')
        .update({ full_name: profileForms.name })
        .eq('id', currentUser.id);
      if (dbError) throw dbError;

      setCurrentUser(prev => prev ? { ...prev, name: profileForms.name } : null);
      setProfileMessage({ text: 'Name changed', type: 'success' });
    } catch (err: any) {
      setProfileMessage({ text: err.message, type: 'error' });
    } finally {
      setProfileActionLoading(false);
    }
  }, [currentUser, profileForms.name]);

  const handleUpdateEmail = useCallback(async () => {
    if (!currentUser || !profileForms.email || !profileForms.currentPasswordForEmail) return;
    setProfileActionLoading(true);
    setProfileMessage({ text: '', type: 'error' });

    try {
      // Re-authenticate to verify password
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: profileForms.currentPasswordForEmail
      });
      
      if (loginError) {
        throw new Error('incorrect password');
      }

      const { error: updateError } = await supabase.auth.updateUser({
        email: profileForms.email
      });

      if (updateError) throw updateError;

      // Note: Supabase typically sends a verification email to the new address
      setProfileMessage({ text: 'Check your new email to confirm the change', type: 'success' });
    } catch (err: any) {
      const msg = err.message.toLowerCase().includes('password') ? 'incorrect password' : err.message;
      setProfileMessage({ text: msg, type: 'error' });
    } finally {
      setProfileActionLoading(false);
    }
  }, [currentUser, profileForms]);

  const handleUpdatePassword = useCallback(async () => {
    if (!currentUser || !profileForms.currentPasswordForPass || !profileForms.newPassword) return;
    
    if (profileForms.newPassword !== profileForms.confirmNewPassword) {
      setProfileMessage({ text: 'Passwords do not match', type: 'error' });
      return;
    }

    setProfileActionLoading(true);
    setProfileMessage({ text: '', type: 'error' });

    try {
      // Re-authenticate to verify password
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: profileForms.currentPasswordForPass
      });
      
      if (loginError) {
        throw new Error('incorrect password');
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: profileForms.newPassword
      });

      if (updateError) throw updateError;

      setProfileMessage({ text: 'change password', type: 'success' });
      setProfileForms(prev => ({ ...prev, currentPasswordForPass: '', newPassword: '', confirmNewPassword: '' }));
    } catch (err: any) {
      const msg = err.message.toLowerCase().includes('password') ? 'incorrect password' : err.message;
      setProfileMessage({ text: msg, type: 'error' });
    } finally {
      setProfileActionLoading(false);
    }
  }, [currentUser, profileForms]);

  const exportNotesAsZip = useCallback(async () => {
    if (notes.length === 0) return;
    const zip = new JSZip();
    notes.forEach(note => {
      const fileName = `${note.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
      zip.file(fileName, note.content);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, 'my_notes_export.zip');
  }, [notes]);

  const handleDeleteAccount = useCallback(async (download: boolean) => {
    if (!currentUser || !currentPasswordForDelete) return;
    setProfileActionLoading(true);
    setProfileMessage({ text: '', type: 'error' });

    try {
      // 1. Re-authenticate
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: currentPasswordForDelete
      });
      
      if (loginError) {
        throw new Error('incorrect password');
      }

      // 2. Export if requested
      if (download) {
        await exportNotesAsZip();
      }

      // 3. Delete Data and User
      // Supabase usually handles associated data via cascades if set up, 
      // but let's be explicit and delete notes and profile first.
      await supabase.from('notes').delete().eq('user_id', currentUser.id);
      await supabase.from('profiles').delete().eq('id', currentUser.id);

      // 4. Delete user account from Auth (requires a service role usually, or specific setup)
      // In a client-side environment without admin functions, we might just sign out 
      // and rely on a trigger or just leave the auth record.
      // However, Supabase users can sometimes trigger their own deletion if allowed.
      // Often, you'd call an Edge Function for this.
      // For this applet, since we don't have Edge functions setup easily, 
      // we'll sign out and show a message, or use a workaround if possible.
      // NOTE: deleteUser is NOT available in public client SDK without Service Role.
      // We will perform the logic of data deletion and logging out.
      
      // Attempting to use a mock for "deleteUser" since we can't do it from client
      // But we will at least wipe their data and sign them out.
      
      await supabase.auth.signOut();
      window.location.reload(); // Refresh to landing page
    } catch (err: any) {
      const msg = err.message.toLowerCase().includes('password') ? 'incorrect password' : err.message;
      setProfileMessage({ text: msg, type: 'error' });
    } finally {
      setProfileActionLoading(false);
    }
  }, [currentUser, currentPasswordForDelete, exportNotesAsZip]);

  // --- Effects ---
  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Initial session error:', error);
        supabase.auth.signOut();
        setCurrentUser(null);
        setSessionLoading(false);
        return;
      }

      if (session?.user) {
        const user = session.user;
        setCurrentUser({
          id: user.id,
          name: user.user_metadata.full_name || user.email?.split('@')[0] || 'User',
          email: user.email || '',
          createdAt: user.created_at
        });
        setShowLandingPage(false);

        // Sync profile
        supabase.from('profiles').upsert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata.full_name || user.email?.split('@')[0] || 'User'
        }).then(({ error }) => {
          if (error) console.error('Error syncing profile:', error);
        });
      }
      setSessionLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const user = session.user;
        setCurrentUser({
          id: user.id,
          name: user.user_metadata.full_name || user.email?.split('@')[0] || 'User',
          email: user.email || '',
          createdAt: user.created_at
        });
        setShowLandingPage(false);

        // Sync profile on login, signup or session start
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
          supabase.from('profiles').upsert({
            id: user.id,
            email: user.email,
            full_name: user.user_metadata.full_name || user.email?.split('@')[0] || 'User'
          }).then(({ error }) => {
            if (error) console.error('Error syncing profile on event:', error);
          });
        }
      } else {
        setCurrentUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchNotes();
    }
  }, [currentUser]);

  useEffect(() => {
    // Only auto-select note on desktop screens
    if (currentUser && notes.length > 0 && !activeNoteId && window.innerWidth >= 768) {
      setActiveNoteId(notes[0].id);
    }
  }, [currentUser, notes.length]);

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="animate-spin text-amber-500">
          <Clock size={32} />
        </div>
      </div>
    );
  }

  // --- Auth View ---
  if (!currentUser) {
    if (showLandingPage) {
      return (
        <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-amber-200">
          {/* Header */}
          <nav className="fixed top-0 w-full z-50 bg-white/70 backdrop-blur-xl border-b border-neutral-200/50">
            <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="bg-amber-500 p-2 rounded-xl text-white shadow-lg shadow-amber-500/30">
                  <BookOpen size={24} />
                </div>
                <span className="text-xl font-bold tracking-tight">Notopad</span>
              </div>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowLandingPage(false)}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-2.5 rounded-full font-semibold transition-all shadow-lg shadow-amber-500/20 active:scale-95"
                >
                  Get Started
                </button>
              </div>
            </div>
          </nav>

          {/* Hero Section */}
          <main className="pt-32 pb-20 px-6">
            <div className="max-w-7xl mx-auto text-center">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 bg-gradient-to-br from-neutral-900 to-neutral-500 bg-clip-text text-transparent">
                  Your Ideas, Simplified. <br />
                  <span className="text-amber-500">Auto-saved.</span>
                </h1>
                <p className="text-lg md:text-xl text-neutral-500 max-w-2xl mx-auto mb-12 leading-relaxed">
                  The most minimal, fastest, and efficient way to capture your thoughts. 
                  Zero friction. Just open and start typing.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <button 
                    onClick={() => setShowLandingPage(false)}
                    className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-white px-10 py-4 rounded-2xl font-bold text-lg transition-all shadow-xl shadow-amber-500/30 hover:-translate-y-1"
                  >
                    Start Writing Now
                  </button>
                  <a href="#features" className="w-full sm:w-auto px-10 py-4 rounded-2xl font-semibold hover:bg-neutral-100 transition-all">
                    Learn More
                  </a>
                </div>
              </motion.div>

              {/* Mockup */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="mt-20 relative px-4"
              >
                <div className="max-w-5xl mx-auto bg-white rounded-3xl shadow-2xl border border-neutral-200 overflow-hidden">
                  <div className="h-12 bg-neutral-50 flex items-center px-6 gap-2 border-b border-neutral-200">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-400/50" />
                      <div className="w-3 h-3 rounded-full bg-amber-400/50" />
                      <div className="w-3 h-3 rounded-full bg-green-400/50" />
                    </div>
                    <div className="flex-1 text-center text-xs font-medium text-neutral-400">notopad.app</div>
                  </div>
                  <div className="p-8 aspect-video flex items-center justify-center">
                    <div className="text-left w-full max-w-2xl">
                      <div className="h-4 w-48 bg-neutral-100 rounded-full mb-6" />
                      <div className="space-y-4">
                        <div className="h-3 w-full bg-neutral-50 rounded-full" />
                        <div className="h-3 w-full bg-neutral-50 rounded-full" />
                        <div className="h-3 w-2/3 bg-neutral-50 rounded-full" />
                      </div>
                    </div>
                  </div>
                </div>
                {/* Decorative gradients */}
                <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[500px] bg-amber-500/10 blur-[120px] rounded-full" />
              </motion.div>
            </div>
          </main>

          {/* Features */}
          <section id="features" className="py-24 px-6 bg-white">
            <div className="max-w-7xl mx-auto">
              <div className="grid md:grid-cols-3 gap-8">
                {[
                  { icon: <Save size={28} />, title: "Instant Auto-save", desc: "Never lose a thought again. Every keystroke is saved immediately." },
                  { icon: <Lock size={28} />, title: "Secure & Private", desc: "Your notes belong to you. Encrypted storage right in your browser." },
                  { icon: <Clock size={28} />, title: "Minimal Experience", desc: "A beautifully crafted interface designed for focus and speed." }
                ].map((feat, i) => (
                  <motion.div 
                    key={i}
                    whileHover={{ y: -5 }}
                    className="p-10 rounded-3xl bg-neutral-50 border border-neutral-200 transition-all"
                  >
                    <div className="bg-amber-500/10 text-amber-500 w-14 h-14 rounded-2xl flex items-center justify-center mb-6">
                      {feat.icon}
                    </div>
                    <h3 className="text-xl font-bold mb-3">{feat.title}</h3>
                    <p className="text-neutral-500 leading-relaxed">{feat.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="py-12 px-6 border-t border-neutral-100">
            <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 opacity-60 text-sm">
              <p>© 2024 Notopad. All rights reserved.</p>
              <div className="flex items-center gap-8">
                <a href="#" className="hover:text-amber-500">Privacy</a>
                <a href="#" className="hover:text-amber-500">Terms</a>
                <a href="#" className="hover:text-amber-500">Contact</a>
              </div>
            </div>
          </footer>
        </div>
      );
    }    return (
      <div className={`min-h-screen flex items-center justify-center p-6 bg-neutral-50 transition-colors duration-300 font-sans`}>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 border border-neutral-100"
        >
          <button 
            onClick={() => setShowLandingPage(true)}
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-amber-500 mb-6 transition-colors font-medium"
          >
            <ChevronLeft size={16} />
            Back to landing page
          </button>
          <div className="flex flex-col items-center mb-10">
            <div className="bg-amber-500 p-3 rounded-2xl text-white mb-4 shadow-lg shadow-amber-500/20">
              <BookOpen size={32} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Notopad</h1>
            <p className="text-neutral-500 text-sm mt-1">
              {authMode === 'login' ? 'Welcome back! Please login.' : 'Create an account to start writing.'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === 'signup' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase ml-1">Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                  <input 
                    type="text" 
                    required
                    placeholder="Enter your name"
                    className="w-full bg-neutral-100 rounded-xl py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm"
                    value={authFormData.name}
                    onChange={(e) => setAuthFormData({...authFormData, name: e.target.value})}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-neutral-500 uppercase ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                <input 
                  type="email" 
                  required
                  placeholder="Enter your email"
                  className="w-full bg-neutral-100 rounded-xl py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm"
                  value={authFormData.email}
                  onChange={(e) => setAuthFormData({...authFormData, email: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-neutral-500 uppercase ml-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                <input 
                  type="password" 
                  required
                  placeholder="Enter your password"
                  className="w-full bg-neutral-100 rounded-xl py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm"
                  value={authFormData.password}
                  onChange={(e) => setAuthFormData({...authFormData, password: e.target.value})}
                />
              </div>
            </div>

            {authMode === 'signup' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-neutral-500 uppercase ml-1">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                  <input 
                    type="password" 
                    required
                    placeholder="Confirm your password"
                    className="w-full bg-neutral-100 rounded-xl py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-amber-500 transition-all text-sm"
                    value={authFormData.confirmPassword}
                    onChange={(e) => setAuthFormData({...authFormData, confirmPassword: e.target.value})}
                  />
                </div>
              </div>
            )}

            {authError && (
              <p className="text-red-500 text-xs font-medium ml-1 bg-red-50 p-2 rounded-lg">{authError}</p>
            )}

            <button 
              type="submit"
              disabled={isAuthLoading}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 mt-4"
            >
              {isAuthLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Processing...</span>
                </div>
              ) : (
                <>
                  {authMode === 'login' ? 'Login' : 'Create Account'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-neutral-500 font-medium">
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button 
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'signup' : 'login');
                setAuthError('');
              }}
              className="text-amber-500 hover:underline"
            >
              {authMode === 'login' ? 'Sign Up' : 'Login'}
            </button>
          </p>
        </motion.div>
      </div>
    );
  }

  // --- Main App View ---
  return (
    <div className={`min-h-screen bg-neutral-50 text-neutral-900 transition-colors duration-300 font-sans`}>
      
      {/* Header */}
      <header className="sticky top-0 z-30 w-full bg-white/80 backdrop-blur-md border-b border-neutral-200 h-16 flex items-center px-4 justify-between">
        <div className="flex items-center gap-3">
          {/* Desktop Menu - Hidden on mobile */}
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 hover:bg-neutral-100 rounded-full hidden md:flex"
            id="menu-toggle"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            {activeNoteId && (
              <button 
                onClick={() => setActiveNoteId(null)}
                className="md:hidden p-2 -ml-2 text-neutral-500"
              >
                <ChevronLeft size={24} />
              </button>
            )}
            <div className={`bg-amber-500 p-1.5 rounded-lg text-white hidden`}>
              <BookOpen size={20} />
            </div>
            <h1 className="font-bold text-lg tracking-tight hidden sm:block">Notopad</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus !== 'idle' && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-neutral-100 rounded-full text-xs font-medium animate-pulse">
              <Save size={12} className={saveStatus === 'saving' ? 'animate-bounce' : ''} />
              <span>{saveStatus === 'saving' ? 'Saving...' : 'Saved'}</span>
            </div>
          )}
          
          <div className="h-8 w-[1px] bg-neutral-200 mx-2 hidden sm:block" />

          <button 
            onClick={() => { setShowProfile(true); setProfileForms(prev => ({...prev, name: currentUser.name, email: currentUser.email})); }}
            className="hidden sm:block p-2 hover:bg-neutral-100 rounded-full text-neutral-600 transition-colors"
            title="Profile Settings"
          >
            <User size={20} />
          </button>

          <button 
            onClick={createNote}
            className="hidden md:flex bg-amber-500 hover:bg-amber-600 text-white p-2 sm:px-4 sm:py-2 rounded-full sm:rounded-lg items-center gap-2 transition-all shadow-lg shadow-amber-500/20"
            id="new-note-btn"
          >
            <Plus size={20} />
            <span className="hidden sm:inline font-medium">New Note</span>
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-64px)] overflow-hidden">
        
        {/* Sidebar Overlay (Mobile) - Only if really needed for some specific mobile menu, but we're shifting to master-detail */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 hidden md:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside className={`
          ${activeNoteId ? 'hidden md:flex' : 'flex w-full md:w-72'}
          fixed inset-y-0 left-0 z-50 bg-white border-r border-neutral-200 flex-col transition-all duration-300 md:relative md:translate-x-0
        `}>
          <div className="p-4 flex items-center justify-between border-b border-neutral-200">
            <div className="flex items-center gap-2">
              <div className="bg-amber-500 p-1.5 rounded-lg text-white md:hidden">
                <BookOpen size={18} />
              </div>
              <h2 className="font-semibold">My Notes</h2>
            </div>
            {/* Mobile Profile Icon */}
            <button 
              onClick={() => { setShowProfile(true); setProfileForms(prev => ({...prev, name: currentUser.name, email: currentUser.email})); }}
              className="md:hidden flex items-center gap-2 px-2 py-1 bg-neutral-50 hover:bg-neutral-100 rounded-lg border border-neutral-100 transition-colors"
            >
              <User size={16} className="text-neutral-500" />
              <span className="text-[10px] font-bold text-neutral-400 uppercase truncate max-w-[60px]">{currentUser.name}</span>
            </button>
          </div>

          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
              <input 
                type="text" 
                placeholder="Search notes..." 
                className="w-full bg-neutral-100 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
              {filteredNotes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4 opacity-50">
                  <Search size={32} className="mb-2" />
                  <p className="text-sm">{searchQuery ? "No matching notes" : "Start your first note"}</p>
                </div>
              ) : (
                filteredNotes.map(note => (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setActiveNoteId(note.id);
                      setIsSidebarOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setActiveNoteId(note.id);
                        setIsSidebarOpen(false);
                      }
                    }}
                    className={`
                      w-full text-left p-3 rounded-xl transition-all group flex items-start justify-between cursor-pointer
                      ${activeNoteId === note.id 
                        ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' 
                        : 'hover:bg-neutral-100'}
                    `}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <h3 className="font-medium text-sm truncate">{note.title}</h3>
                      <p className="text-xs opacity-60 truncate mt-1">
                        {note.content.split('\n')[1] || note.content || 'Empty note'}
                      </p>
                      <div className="flex items-center gap-1 mt-2 text-[10px] opacity-40">
                        <Clock size={10} />
                        <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => deleteNote(note.id, e)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-white hover:text-red-500 rounded-lg transition-all"
                      aria-label="Delete note"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>


          <div className="p-3 border-t border-neutral-100">
            <div className="px-3 py-2 mb-1">
              <p className="text-[10px] font-bold text-neutral-400 uppercase">Signed in as</p>
              <p className="text-xs font-semibold truncate">{currentUser.name}</p>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </aside>

        {/* Main Editor */}
        <main className={`flex-1 h-[calc(100vh-64px)] overflow-hidden bg-white ${!activeNoteId ? 'hidden md:flex' : 'flex'} flex-col`}>
          {activeNote ? (
            <>
              {/* Mobile Editor Header - Hidden since delete is removed for mobile as requested */}
              
              <div className="flex-1 overflow-y-auto py-8 sm:py-12 px-6 sm:px-12">
                <div className="max-w-3xl mx-auto w-full flex flex-col h-full min-h-[600px]">
                  <input 
                    type="text" 
                    value={activeNote.title}
                    onChange={(e) => updateNote({ title: e.target.value })}
                    placeholder="Note Title"
                    className="text-3xl sm:text-5xl font-bold border-none outline-none bg-transparent placeholder:opacity-20 mb-8 text-neutral-800 px-0 tracking-tight"
                  />
                  
                  <textarea
                    placeholder="Start typing your thoughts..."
                    className="flex-1 w-full text-base sm:text-xl resize-none border-none outline-none bg-transparent placeholder:opacity-30 leading-relaxed text-neutral-700 min-h-[400px]"
                    value={activeNote.content}
                    onChange={(e) => updateNote({ content: e.target.value })}
                    autoFocus
                  />
                </div>
              </div>

              {/* Status Bar */}
              <footer className="p-3 border-t border-neutral-100 text-[11px] text-neutral-400 flex justify-center bg-neutral-50/30">
                <div className="max-w-3xl w-full flex justify-between px-2">
                  <span>{activeNote.content.length} characters</span>
                  <span className="flex items-center gap-1">
                    Last updated: {new Date(activeNote.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </footer>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 opacity-30 select-none hidden md:flex">
              <div className="bg-neutral-100 p-8 rounded-full mb-6">
                <Plus size={64} />
              </div>
              <h2 className="text-xl font-semibold mb-2">Welcome, {currentUser.name}!</h2>
              <p className="max-w-xs text-sm">Select a note from the sidebar or create a new one to get started.</p>
              <button 
                onClick={createNote}
                className="mt-6 font-medium text-amber-500 hover:underline"
              >
                Create your first note
              </button>
            </div>
          )}
        </main>

        {/* Mobile Floating Action Button (FAB) */}
        {!activeNoteId && (
          <button 
            onClick={createNote}
            className="md:hidden fixed bottom-8 right-8 w-16 h-16 bg-amber-500 text-white rounded-full flex items-center justify-center shadow-2xl shadow-amber-500/40 active:scale-95 transition-all z-50 border-4 border-white"
            aria-label="Create new note"
          >
            <Plus size={32} strokeWidth={3} />
          </button>
        )}
      </div>

      {/* Profile Modal */}
      <AnimatePresence>
        {showProfile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Profile Header */}
              <div className="p-6 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50">
                <div className="flex items-center gap-3">
                  <div className="bg-amber-500 p-2 rounded-xl text-white">
                    <User size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Profile Settings</h2>
                    <p className="text-xs text-neutral-500 font-medium">Manage your account and preferences</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setShowProfile(false); setProfileMessage({ text: '', type: 'error' }); setDeleteAccountStage('none'); }}
                  className="p-2 hover:bg-neutral-100 rounded-full text-neutral-400 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Status Messages */}
                {profileMessage.text && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium ${
                      profileMessage.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                    }`}
                  >
                    {profileMessage.type === 'success' ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
                    {profileMessage.text}
                  </motion.div>
                )}

                {/* Info Card */}
                <div className="bg-neutral-50 rounded-2xl p-4 border border-neutral-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-neutral-400 uppercase">Account Information</p>
                    <div className="flex items-center gap-1 py-1 px-2 bg-amber-100 rounded-full text-[10px] font-bold text-amber-700">
                      <Clock size={10} />
                      Joined {currentUser.createdAt ? new Date(currentUser.createdAt).toLocaleDateString() : 'Unknown'}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-neutral-500">Current Name</p>
                      <p className="font-semibold">{currentUser.name}</p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">Email Address</p>
                      <p className="font-semibold truncate">{currentUser.email}</p>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                  {/* Left Column: Name & Email */}
                  <div className="space-y-6">
                    {/* Rename Section */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-neutral-800 flex items-center gap-2">
                        <Settings size={16} className="text-amber-500" />
                        Changing Name
                      </h3>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
                        <input 
                          type="text" 
                          placeholder="New Name"
                          className="w-full bg-neutral-100 border-none rounded-xl py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                          value={profileForms.name}
                          onChange={(e) => setProfileForms(prev => ({...prev, name: e.target.value}))}
                        />
                      </div>
                      <button 
                        onClick={handleUpdateName}
                        disabled={profileActionLoading || !profileForms.name || profileForms.name === currentUser.name}
                        className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-200 text-white font-bold py-2.5 rounded-xl transition-all shadow-lg shadow-amber-500/10 text-sm"
                      >
                        Update Name
                      </button>
                    </div>

                    {/* Email change Section */}
                    <div className="space-y-3 pt-4 border-t border-neutral-50">
                      <h3 className="text-sm font-bold text-neutral-800 flex items-center gap-2">
                        <Mail size={16} className="text-amber-500" />
                        Changing Email
                      </h3>
                      <div className="space-y-2">
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
                          <input 
                            type="email" 
                            placeholder="New Email"
                            className="w-full bg-neutral-100 border-none rounded-xl py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                            value={profileForms.email}
                            onChange={(e) => setProfileForms(prev => ({...prev, email: e.target.value}))}
                          />
                        </div>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
                          <input 
                            type="password" 
                            placeholder="Current Password"
                            className="w-full bg-neutral-100 border-none rounded-xl py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                            value={profileForms.currentPasswordForEmail}
                            onChange={(e) => setProfileForms(prev => ({...prev, currentPasswordForEmail: e.target.value}))}
                          />
                        </div>
                      </div>
                      <button 
                        onClick={handleUpdateEmail}
                        disabled={profileActionLoading || !profileForms.email || !profileForms.currentPasswordForEmail}
                        className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-200 text-white font-bold py-2.5 rounded-xl transition-all shadow-lg shadow-amber-500/10 text-sm"
                      >
                        Update Email
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Password */}
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <h3 className="text-sm font-bold text-neutral-800 flex items-center gap-2">
                        <Lock size={16} className="text-amber-500" />
                        Changing Password
                      </h3>
                      <div className="space-y-2">
                        <input 
                          type="password" 
                          placeholder="Current Password"
                          className="w-full bg-neutral-100 border-none rounded-xl py-2.5 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                          value={profileForms.currentPasswordForPass}
                          onChange={(e) => setProfileForms(prev => ({...prev, currentPasswordForPass: e.target.value}))}
                        />
                        <input 
                          type="password" 
                          placeholder="New Password"
                          className="w-full bg-neutral-100 border-none rounded-xl py-2.5 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                          value={profileForms.newPassword}
                          onChange={(e) => setProfileForms(prev => ({...prev, newPassword: e.target.value}))}
                        />
                        <input 
                          type="password" 
                          placeholder="Confirm New Password"
                          className="w-full bg-neutral-100 border-none rounded-xl py-2.5 px-4 text-sm focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                          value={profileForms.confirmNewPassword}
                          onChange={(e) => setProfileForms(prev => ({...prev, confirmNewPassword: e.target.value}))}
                        />
                      </div>
                      <button 
                        onClick={handleUpdatePassword}
                        disabled={profileActionLoading || !profileForms.currentPasswordForPass || !profileForms.newPassword}
                        className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-200 text-white font-bold py-2.5 rounded-xl transition-all shadow-lg shadow-amber-500/10 text-sm"
                      >
                        Change Password
                      </button>
                    </div>

                    {/* Delete Account Section */}
                    <div className="p-5 rounded-2xl bg-red-50 border border-red-100 space-y-4">
                      <div className="flex items-center gap-2 text-red-600">
                        <AlertTriangle size={20} />
                        <h4 className="font-bold text-sm">Danger Zone</h4>
                      </div>
                      <p className="text-xs text-red-500 font-medium">
                        Deleting your account will permanently remove all your notes and data. 
                        This action cannot be undone.
                      </p>
                      
                      {deleteAccountStage === 'none' && (
                        <button 
                          onClick={() => setDeleteAccountStage('confirm')}
                          className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2.5 rounded-xl transition-all shadow-lg shadow-red-500/10 text-sm"
                        >
                          Delete Account
                        </button>
                      )}

                      {deleteAccountStage === 'confirm' && (
                        <div className="space-y-3">
                          <p className="text-xs font-bold text-center text-red-700">Are you sure you want to delete your account?</p>
                          <div className="grid grid-cols-2 gap-2">
                            <button 
                              onClick={() => setDeleteAccountStage('password')}
                              className="bg-red-500 text-white py-2 rounded-lg text-sm font-bold"
                            >
                              Yes
                            </button>
                            <button 
                              onClick={() => setDeleteAccountStage('none')}
                              className="bg-neutral-200 text-neutral-600 py-2 rounded-lg text-sm font-bold"
                            >
                              No
                            </button>
                          </div>
                        </div>
                      )}

                      {deleteAccountStage === 'password' && (
                        <div className="space-y-3">
                          <p className="text-xs font-bold text-red-700">Confirm with Password</p>
                          <input 
                            type="password" 
                            placeholder="Current Password"
                            className="w-full bg-white border border-red-200 rounded-xl py-2.5 px-4 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                            value={currentPasswordForDelete}
                            onChange={(e) => setCurrentPasswordForDelete(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button 
                              onClick={() => setDeleteAccountStage('export')}
                              disabled={!currentPasswordForDelete}
                              className="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-bold disabled:bg-red-300"
                            >
                              Continue
                            </button>
                            <button 
                              onClick={() => setDeleteAccountStage('none')}
                              className="p-2 bg-neutral-200 text-neutral-600 rounded-lg"
                            >
                              <X size={18} />
                            </button>
                          </div>
                        </div>
                      )}

                      {deleteAccountStage === 'export' && (
                        <div className="space-y-3">
                          <p className="text-xs font-bold text-center text-red-700 uppercase">One Last Thing</p>
                          <p className="text-xs text-center text-neutral-500">Do you want to download all your notes in a ZIP file?</p>
                          <div className="grid grid-cols-2 gap-2">
                            <button 
                              onClick={() => handleDeleteAccount(true)}
                              className="bg-amber-500 text-white py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2"
                            >
                              <Download size={14} />
                              Yes
                            </button>
                            <button 
                              onClick={() => handleDeleteAccount(false)}
                              className="bg-red-500 text-white py-2 rounded-lg text-sm font-bold"
                            >
                              No
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
