import { useState, useRef, useEffect, useCallback } from 'react'
import * as tf from '@tensorflow/tfjs'
import * as mobilenet from '@tensorflow-models/mobilenet'
import './App.css'

// Game stages
const STAGE_INSTALL = 'install'
const STAGE_PIN = 'pin'
const STAGE_BLACK = 'black'        
const STAGE_BAT_ANIMATION = 'bats' 
const STAGE_LOGO_READY = 'ready'   
const STAGE_HINT = 'hint'          
const STAGE_REVIEW = 'review'

const ACCESS_PIN = '1110'      

// Challenges configuration - Těžší hádanky s místnostmi v domě
const CHALLENGES = [
  {
    id: 1,
    hint: "HÁDANKA: Čím déle a víc mi sloužíš, tím jsem kratší a menší. Mám grafitové srdce sevřené v dřevěném těle. Mluvím beze slov a má stopa snadno zmizí pod kouzelnou pryží. Co jsem?",
    room: "Pracovna / Dětský pokoj",
    locationHint: "Hledej na psacím stole, v penálu nebo mezi sešity.",
    name: "Tužka",
    keywords: ["pencil", "pen", "quill", "ballpoint", "writing", "marker", "crayon", "rubber eraser"]
  },
  {
    id: 2,
    hint: "HÁDANKA: Mám kovové zuby bez čelistí a tělo ze železa. Dokážu spoutat i osvobodit celé domy a pokoje. Cinkám v temnotě kapes a nosím v sobě tajemství zámků. Co jsem?",
    room: "Předsíň / Chodba",
    locationHint: "Odpočívám v misce u vchodových dveří, visím na věšáku nebo v kapse kabátu.",
    name: "Klíče",
    keywords: ["key", "keys", "lock", "padlock", "chain", "hook"]
  },
  {
    id: 3,
    hint: "HÁDANKA: Mám jediné ucho, kterým nikdy nic neuslyším, a hluboké břicho, do kterého rád pojmu vařící lázeň. Každé ráno líbám tvé rty a zahřívám tvé zkřehlé dlaně. Co jsem?",
    room: "Kuchyně",
    locationHint: "Hledej poblíž rychlovarné konvice, kávovaru, v poličce nebo u dřezu.",
    name: "Hrneček",
    keywords: ["cup", "mug", "coffee", "coffeepot", "coffee mug", "espresso", "teapot", "pitcher"]
  },
  {
    id: 4,
    hint: "HÁDANKA: Mám stovky listů, ale nesmáčel mě déšť. Mám pevný hřbet, ale nemám kosti ani páteř. Když mě otevřeš, promluvím k tobě hlasy lidí z dávných časů a cizích světů. Co jsem?",
    room: "Obývací pokoj / Knihovna",
    locationHint: "Hledej v polici s knihami, na konferenčním stolku nebo u pohovky.",
    name: "Kniha",
    keywords: ["book", "notebook", "binder", "bookcase", "library", "book jacket", "comic book", "paperback"]
  },
  {
    id: 5,
    hint: "HÁDANKA: Chodíme vždycky v páru, ale nikdy se nepředběhneme. Máme jazyk, kterým nikdy nepromluvíme, a desítky očí svázaných šňůrkou. Chráníme tvé nohy před chladem a kameny. Co jsme?",
    room: "Zádveří / Vstupní hala",
    locationHint: "Hledej u vchodu, na rohožce nebo v botníku na zemi.",
    name: "Boty",
    keywords: ["shoe", "shoes", "boot", "sneaker", "running shoe", "loafer", "sandal", "clog", "cowboy boot", "tennis shoe"]
  }
]

// Web Audio API Synthesizer for bat sound
const playBatSound = () => {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const osc = audioCtx.createOscillator()
        const gainNode = audioCtx.createGain()
        
        osc.type = 'sine'
        osc.frequency.setValueAtTime(3000 + Math.random() * 2000, audioCtx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.1)
        
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime)
        gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.02)
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1)
        
        osc.connect(gainNode)
        gainNode.connect(audioCtx.destination)
        
        osc.start()
        osc.stop(audioCtx.currentTime + 0.1)
      }, i * 150 + Math.random() * 100)
    }
  } catch (e) {
    console.error("Audio not supported", e)
  }
}

function App() {
  // Pokud už aplikace běží jako nainstalovaná (standalone), přeskočíme rovnou na černou obrazovku
  const isStandalone = typeof window !== 'undefined' && (
    window.matchMedia('(display-mode: standalone)').matches || 
    window.navigator.standalone === true
  )

  const [stage, setStage] = useState(() => isStandalone ? STAGE_PIN : STAGE_INSTALL)
  const [tapCount, setTapCount] = useState(0)
  const [showTapToPlay, setShowTapToPlay] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showIosGuide, setShowIosGuide] = useState(false)
  
  // PIN code state
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState(false)

  const handlePinDigit = (digit) => {
    if (pin.length >= 4) return
    const newPin = pin + digit
    setPin(newPin)
    setPinError(false)

    if (newPin.length === 4) {
      if (newPin === ACCESS_PIN) {
        setTimeout(() => {
          setStage(STAGE_BLACK)
        }, 300)
      } else {
        setTimeout(() => {
          setPinError(true)
          setPin('')
        }, 400)
      }
    }
  }

  const handlePinBackspace = () => {
    setPin(prev => prev.slice(0, -1))
    setPinError(false)
  }
  
  // Game state
  const [currentChallengeIndex, setCurrentChallengeIndex] = useState(0)
  const [capturedImage, setCapturedImage] = useState(null)
  const [comparing, setComparing] = useState(false)
  const [matchResult, setMatchResult] = useState(null)
  const [gameMasterPhotos, setGameMasterPhotos] = useState([]) // Uložené fotky pro koncovou kontrolu
  const [model, setModel] = useState(null)
  const [isModelLoading, setIsModelLoading] = useState(false)
  const [warningMessage, setWarningMessage] = useState(null)
  const [showLocationHint, setShowLocationHint] = useState(false)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const fileInputRef = useRef(null)
  const modelRef = useRef(null)

  const MAX_TAPS = 10
  const currentChallenge = CHALLENGES[currentChallengeIndex]

  // Zachycení instalačního promptu pro Android / Chrome
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
  }, [])

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setDeferredPrompt(null)
      }
    } else {
      // Pro iOS nebo prohlížeče bez nativního promptu zobrazíme jednoduchý návod
      setShowIosGuide(true)
    }
  }

  // =====================
  // STAGE: BLACK SCREEN
  // =====================
  const handleBlackTap = () => {
    if (stage !== STAGE_BLACK) return

    const newCount = tapCount + 1
    setTapCount(newCount)

    if (newCount >= MAX_TAPS) {
      setStage(STAGE_BAT_ANIMATION)
      playBatSound()
      
      setTimeout(() => {
        setStage(STAGE_LOGO_READY)
        setShowTapToPlay(true) 
      }, 2500)
    }
  }

  const [apiKey, setApiKey] = useState(() => {
    return import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || ''
  })
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [tempKeyInput, setTempKeyInput] = useState('')

  const handleSaveApiKey = (keyToSave) => {
    const trimmed = keyToSave.trim()
    setApiKey(trimmed)
    localStorage.setItem('gemini_api_key', trimmed)
    setShowKeyModal(false)
  }

  const handleStartGame = () => {
    if (!showTapToPlay) return
    setStage(STAGE_HINT)
  }

  // Vyhodnocení pomocí chytrého Gemini Flash API
  const evaluateWithGemini = async (base64Data, challenge) => {
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const activeKey = apiKey || import.meta.env.VITE_GEMINI_API_KEY

    const promptText = `Jsi přísný ale spravedlivý rozhodčí v dětské hře Hledání pokladu (Scavenger Hunt).
Hráč má najít a vyfotit předmět: "${challenge.name}".
Nápověda pro úkol: "${challenge.hint}".

Zhodnoť přiloženou fotku a odpověz POUZE ve validním JSON formátu bez markdown uvozovek:
{
  "isMatch": true nebo false,
  "detected": "co na fotce vidíš (česky v pár slovech)",
  "comment": "krátké vysvětlení v jedné větě pro hráče (česky)"
}
Pokud je požadovaný předmět na fotce skutečně vidět (i částečně, v ruce nebo na stole), dej isMatch: true. Pokud je tam něco úplně jiného, dej isMatch: false.`

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: cleanBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          response_mime_type: 'application/json'
        }
      })
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      throw new Error(errData.error?.message || `Chyba Gemini API (${response.status})`)
    }

    const data = await response.json()
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim()
    return JSON.parse(cleanJson)
  }

  // Hlavní AI vyhodnocení obrázku
  const analyzePhoto = async (base64Data) => {
    setComparing(true)
    setMatchResult(null)

    // 1. Zkusíme Gemini Flash, pokud máme klíč
    const activeKey = apiKey || import.meta.env.VITE_GEMINI_API_KEY
    if (activeKey) {
      try {
        const result = await evaluateWithGemini(base64Data, currentChallenge)
        if (result.isMatch) {
          setMatchResult({
            success: true,
            message: `✨ Gemini AI: ${result.comment || `Skvěle, to je ${currentChallenge.name}!`}`
          })
        } else {
          setMatchResult({
            success: false,
            message: `❌ Gemini AI: ${result.comment || `Tohle nevypadá jako ${currentChallenge.name}. Vidím spíše: ${result.detected || 'něco jiného'}.`}`
          })
        }
        setComparing(false)
        return
      } catch (err) {
        console.warn('Gemini API call failed, falling back to local model:', err)
        // Pokračujeme na záložní zpracování níže
      }
    }

    // 2. Záložní zpracování (MobileNet lokálně)
    try {
      let m = modelRef.current
      if (!m) {
        setIsModelLoading(true)
        m = await mobilenet.load({ version: 2, alpha: 1.0 })
        modelRef.current = m
        setModel(m)
        setIsModelLoading(false)
      }

      const img = new Image()
      img.src = base64Data
      await new Promise(r => { img.onload = r })

      const predictions = await m.classify(img, 5)
      const keywords = currentChallenge.keywords || []
      let matched = false
      let bestMatch = ''

      for (const pred of predictions) {
        const className = pred.className.toLowerCase()
        for (const keyword of keywords) {
          if (className.includes(keyword.toLowerCase())) {
            matched = true
            bestMatch = pred.className
            break
          }
        }
        if (matched) break
      }

      if (matched) {
        setMatchResult({
          success: true,
          message: `✅ AI rozpoznala: "${bestMatch}" — Správně! To je ${currentChallenge.name}!`
        })
      } else {
        const topGuess = predictions[0]?.className || '???'
        setMatchResult({
          success: false,
          message: `❌ AI vidí: "${topGuess}" — To nevypadá jako ${currentChallenge.name}. Zkus to znovu!`
        })
      }
    } catch (err) {
      console.error('All AI checks failed:', err)
      setMatchResult({
        success: true,
        message: `📸 Vyfoceno! (AI kontrola byla přeskočena, fotku zkontroluje Pán Jeskyně.)`
      })
    } finally {
      setComparing(false)
    }
  }

  // =====================
  // CAMERA LOGIC
  // =====================
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (err) {
      console.error('Camera error:', err)
      if (fileInputRef.current) {
        fileInputRef.current.click()
      }
    }
  }

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
  }, [])

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current
      const canvas = canvasRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      
      const imageData = canvas.toDataURL('image/jpeg', 0.8)
      setCapturedImage(imageData)
      stopCamera()
      analyzePhoto(imageData)
    }
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const imageData = ev.target.result
      setCapturedImage(imageData)
      stopCamera()
      analyzePhoto(imageData)
    }
    reader.readAsDataURL(file)
  }

  const retakePhoto = () => {
    setCapturedImage(null)
    setMatchResult(null)
    setWarningMessage(null)
    startCamera()
  }
  
  const nextChallenge = () => {
    // Kontrola: musí být vyfocená fotka
    if (!capturedImage) {
      setWarningMessage('⚠️ Nejdřív musíš předmět vyfotit!')
      setTimeout(() => setWarningMessage(null), 3500)
      return
    }
    // Kontrola: porovnávání ještě běží
    if (comparing) {
      setWarningMessage('⏳ AI právě fotku vyhodnocuje, chvilku strpení...')
      setTimeout(() => setWarningMessage(null), 3000)
      return
    }
    // Kontrola: AI musí fotku schválit
    if (!matchResult || !matchResult.success) {
      setWarningMessage('⚠️ AI předmět neschválila. Vyfoť správný předmět!')
      setTimeout(() => setWarningMessage(null), 3500)
      return
    }

    // Uložíme fotku do dočasné paměti pro finální kontrolu
    const newPhotos = [...gameMasterPhotos, { id: currentChallenge.id, name: currentChallenge.name, image: capturedImage }]
    setGameMasterPhotos(newPhotos)
    setWarningMessage(null)

    if (currentChallengeIndex < CHALLENGES.length - 1) {
      setCurrentChallengeIndex(prev => prev + 1)
      setCapturedImage(null)
      setMatchResult(null)
      setShowLocationHint(false)
      startCamera()
    } else {
      setStage(STAGE_REVIEW)
    }
  }

  // Cleanup camera on unmount
  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  // Start camera when entering hint stage
  useEffect(() => {
    if (stage === STAGE_HINT && !capturedImage) {
      startCamera()
    }
  }, [stage, capturedImage])

  // =====================
  // RENDER: INSTALL SCREEN (Vstupní stránka po naskenování QR)
  // =====================
  if (stage === STAGE_INSTALL) {
    return (
      <div className="screen install-screen">
        <div className="install-card">
          <div className="install-badge">🦇 PWA Mobilní Hra</div>
          
          <div className="logo-treasure" style={{ margin: '10px 0' }}>
            <span className="logo-icon-big" style={{ fontSize: '56px' }}>🦇</span>
            <h1 className="logo-title" style={{ fontSize: '28px' }}>SCAVENGER</h1>
            <h1 className="logo-title logo-title-accent" style={{ fontSize: '28px' }}>HUNT</h1>
          </div>

          <p className="install-desc">
            Vítej v detektivní hře! Hledej ukryté předměty a nech je ověřit umělou inteligencí přímo foťákem mobilu.
          </p>

          <div className="install-actions">
            <button className="install-btn-main" onClick={handleInstallClick}>
              📲 Nainstalovat do mobilu
            </button>
            <button className="install-btn-sub" onClick={() => setStage(STAGE_PIN)}>
              🎮 Vstoupit do hry ➡️
            </button>
          </div>

          {/* Návod pro iPhone / Safari */}
          {showIosGuide && (
            <div className="ios-guide-modal">
              <div className="ios-guide-box">
                <h3>📲 Jak nainstalovat na iPhone:</h3>
                <ol>
                  <li>Klikni v Safari dole na tlačítko <b>Sdílet ⎋</b></li>
                  <li>Sjeď níže a klikni na <b>Přidat na plochu ⊞</b></li>
                  <li>Potvrď kliknutím na <b>Přidat</b> vpravo nahoře</li>
                </ol>
                <button className="action-btn-secondary" onClick={() => setShowIosGuide(false)}>
                  Rozumím 👍
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // =====================
  // RENDER: PIN SCREEN (Zabezpečení kódem 1110)
  // =====================
  if (stage === STAGE_PIN) {
    return (
      <div className="screen pin-screen">
        <div className="pin-card">
          <div className="pin-icon">🔐</div>
          <h2>Tajný kód</h2>
          <p>Pro vstup do hry zadej 4místný PIN kód:</p>

          <div className={`pin-dots ${pinError ? 'pin-dots-error' : ''}`}>
            {[0, 1, 2, 3].map((idx) => (
              <span
                key={idx}
                className={`pin-dot ${idx < pin.length ? 'filled' : ''} ${pinError ? 'error' : ''}`}
              />
            ))}
          </div>

          {pinError && (
            <p className="pin-error-text">❌ Špatný kód! Zkus to znovu.</p>
          )}

          <div className="pin-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                className="pin-key"
                onClick={() => handlePinDigit(digit)}
              >
                {digit}
              </button>
            ))}
            <button
              className="pin-key pin-key-empty"
              onClick={() => setStage(STAGE_INSTALL)}
              title="Zpět"
            >
              ↩️
            </button>
            <button
              className="pin-key"
              onClick={() => handlePinDigit('0')}
            >
              0
            </button>
            <button
              className="pin-key pin-key-backspace"
              onClick={handlePinBackspace}
              title="Smazat"
            >
              ⌫
            </button>
          </div>
        </div>
      </div>
    )
  }

  // =====================
  // RENDER: BLACK SCREEN
  // =====================
  if (stage === STAGE_BLACK) {
    const logoScale = tapCount / MAX_TAPS
    const logoOpacity = tapCount > 0 ? Math.min(tapCount / (MAX_TAPS * 0.5), 1) : 0

    return (
      <div className="screen black-screen" onClick={handleBlackTap}>
        {tapCount > 0 && (
          <div
            className="logo-reveal"
            style={{
              transform: `scale(${logoScale})`,
              opacity: logoOpacity,
            }}
          >
            <div className="logo-treasure">
              <span className="logo-icon-big">🦇</span>
              <h1 className="logo-title">SCAVENGER</h1>
              <h1 className="logo-title logo-title-accent">HUNT</h1>
            </div>
          </div>
        )}

        <div className="tap-counter">
          {Array.from({ length: MAX_TAPS }, (_, i) => (
             <span key={i} className={`tap-dot ${i < tapCount ? 'active' : ''}`} />
          ))}
        </div>
      </div>
    )
  }

  // =====================
  // RENDER: BAT ANIMATION
  // =====================
  if (stage === STAGE_BAT_ANIMATION) {
    return (
      <div className="screen bat-animation-screen">
        <div className="logo-reveal" style={{ transform: 'scale(1)', opacity: 1 }}>
          <div className="logo-treasure">
            <span className="logo-icon-big">🦇</span>
            <h1 className="logo-title">SCAVENGER</h1>
            <h1 className="logo-title logo-title-accent">HUNT</h1>
          </div>
        </div>

        <div className="bat-overlay">
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.5
            const distance = 150 + Math.random() * 50
            const txEnd = `${Math.cos(angle) * distance}px`
            const tyEnd = `${Math.sin(angle) * distance}px`
            const delay = `${Math.random() * 0.3}s`
            
            return (
              <div 
                key={i} 
                className="bat" 
                style={{ 
                  '--tx-start': '0px', 
                  '--ty-start': '0px', 
                  '--tx-end': txEnd, 
                  '--ty-end': tyEnd,
                  animationDelay: delay
                }}
              >
                🦇
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // =====================
  // RENDER: LOGO READY
  // =====================
  if (stage === STAGE_LOGO_READY) {
    return (
      <div className="screen logo-screen" onClick={handleStartGame}>
        <div className="logo-reveal" style={{ transform: 'scale(1)', opacity: 1 }}>
          <div className="logo-treasure">
            <span className="logo-icon-big">🦇</span>
            <h1 className="logo-title">SCAVENGER</h1>
            <h1 className="logo-title logo-title-accent">HUNT</h1>
          </div>
        </div>

        {showTapToPlay && (
          <p className="tap-to-play">tap to play</p>
        )}
      </div>
    )
  }

  // =====================
  // RENDER: HINT + CAMERA
  // =====================
  if (stage === STAGE_HINT) {
    if (!currentChallenge) return null

    const hasApiKey = Boolean(apiKey || import.meta.env.VITE_GEMINI_API_KEY)

    return (
      <div className="screen hint-screen">
        {/* Horní sekce s nápovědou a stavem AI */}
        <div className="hint-section">
          <div className="hint-header">
            <span className="hint-icon">📜</span>
            <h2 style={{ flex: 1 }}>Úkol {currentChallenge.id} z {CHALLENGES.length}</h2>
            <button
              onClick={() => {
                setTempKeyInput(apiKey)
                setShowKeyModal(true)
              }}
              style={{
                background: hasApiKey ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                border: `1px solid ${hasApiKey ? 'var(--success)' : '#eab308'}`,
                color: hasApiKey ? 'var(--success)' : '#fef08a',
                padding: '4px 10px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {hasApiKey ? '✨ Gemini AI' : '🔑 Klíč AI'}
            </button>
          </div>
          <div className="hint-card">
            <p className="hint-text">{currentChallenge.hint}</p>

            {/* Odkrývací nápověda s místností */}
            <div className="location-reveal-container">
              {!showLocationHint ? (
                <button
                  className="reveal-hint-btn"
                  onClick={() => setShowLocationHint(true)}
                >
                  🔍 Zobrazit nápovědu místnosti
                </button>
              ) : (
                <div className="location-revealed-box">
                  <div className="location-room-tag">
                    🏠 <b>Místnost:</b> {currentChallenge.room}
                  </div>
                  <p className="location-detail-text">
                    📍 {currentChallenge.locationHint}
                  </p>
                  <button
                    className="hide-hint-link"
                    onClick={() => setShowLocationHint(false)}
                  >
                    Ukrýt nápovědu ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Hledáček nebo vyfocená fotka */}
        <div className="camera-section">
          {!capturedImage ? (
            <div className="camera-viewfinder">
              <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
              <div className="viewfinder-overlay">
                <div className="viewfinder-corner tl" />
                <div className="viewfinder-corner tr" />
                <div className="viewfinder-corner bl" />
                <div className="viewfinder-corner br" />
              </div>
            </div>
          ) : (
            <div className="captured-result">
              <img src={capturedImage} alt="Captured" className="captured-photo" />
              
              {comparing && (
                <div className="comparing-overlay">
                  <div className="spinner" />
                  <p>{hasApiKey ? '✨ Gemini AI zkoumá fotografii...' : (isModelLoading ? '🧠 Načítám lokální model...' : '🔍 Lokální AI analyzuje obrázek...')}</p>
                </div>
              )}
              
              {matchResult && (
                <div className={`match-result-banner ${matchResult.success ? 'success' : 'fail'}`}>
                  <span className="match-icon">{matchResult.success ? '✅' : '❌'}</span>
                  <p>{matchResult.message}</p>
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>

        {/* Varovná hláška při chybě */}
        {warningMessage && (
          <div className="warning-message">
            <p>{warningMessage}</p>
          </div>
        )}

        {/* Spodní akční lišta - VŽDYCKY VIDITELNÁ */}
        <div className="action-buttons">
          {!capturedImage ? (
            <>
              <button 
                className="capture-btn" 
                onClick={capturePhoto} 
                title="Vyfotit"
              >
                <span className="capture-btn-inner" />
              </button>
              <button 
                className="action-btn-primary" 
                onClick={nextChallenge}
              >
                Další úkol ➡️
              </button>
            </>
          ) : (
            <>
              <button 
                className="action-btn-secondary" 
                onClick={retakePhoto}
              >
                🔄 Vyfotit znovu
              </button>
              <button 
                className={`action-btn-primary ${(!matchResult?.success || comparing) ? 'action-btn-disabled' : ''}`}
                onClick={nextChallenge}
              >
                Další úkol ➡️
              </button>
            </>
          )}
        </div>

        {/* Modální okno pro zadání Gemini API klíče */}
        {showKeyModal && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(6px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}>
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              padding: '20px',
              width: '100%',
              maxWidth: '360px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px'
            }}>
              <h3 style={{ fontSize: '16px', color: 'var(--text)' }}>✨ Gemini API Klíč (Zdarma)</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Zadej svůj bezplatný klíč z <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>Google AI Studio</a> pro 100% spolehlivé rozpoznávání:
              </p>
              <input
                type="text"
                value={tempKeyInput}
                onChange={(e) => setTempKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  background: '#0a0a0a',
                  border: '1px solid var(--border)',
                  color: '#fff',
                  fontSize: '14px'
                }}
              />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  className="action-btn-secondary"
                  onClick={() => setShowKeyModal(false)}
                >
                  Zrušit
                </button>
                <button
                  className="action-btn-primary"
                  onClick={() => handleSaveApiKey(tempKeyInput)}
                >
                  Uložit klíč
                </button>
              </div>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    )
  }

  // =====================
  // RENDER: REVIEW (Konec hry)
  // =====================
  if (stage === STAGE_REVIEW) {
    return (
      <div className="screen review-screen">
        <h2>Konec hry! 🎉</h2>
        <p>Tady jsou tvoje nalezené předměty.<br/>Ukaž je Pánovi Jeskyně ke kontrole!</p>
        
        <div className="gallery">
          {gameMasterPhotos.map((photo, i) => (
            <div key={i} className="gallery-item">
              <img src={photo.image} alt={photo.name} />
              <p>{photo.id}. {photo.name}</p>
            </div>
          ))}
        </div>

        <button 
          className="retake-btn next-btn" 
          onClick={() => window.location.reload()}
          style={{ marginTop: '20px' }}
        >
          Smazat fotky a hrát znovu
        </button>
      </div>
    )
  }

  return null
}

export default App
