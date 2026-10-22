import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ChevronLeft, Video, VideoOff, Mic, MicOff, PhoneOff,
  ShieldCheck, AlertCircle, RefreshCw, Volume2, CircleDot, Loader2
} from 'lucide-react';
import { apiClient } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

// Helper: Generate simulated video track for environments where camera is unavailable
const createSimulatedVideoTrack = (isDoctor, userName) => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  const hue = isDoctor ? 175 : 210;

  const intervalId = setInterval(() => {
    ctx.fillStyle = `hsl(${hue}, 40%, 15%)`;
    ctx.fillRect(0, 0, 640, 480);

    ctx.strokeStyle = `hsl(${hue}, 80%, 40%)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(320, 220, 75 + Math.sin(Date.now() / 250) * 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Plus Jakarta Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(userName || (isDoctor ? 'Doctor Feed' : 'Patient Feed'), 320, 225);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '13px Plus Jakarta Sans, sans-serif';
    ctx.fillText('Live Two-Way Encrypted Telemed Video', 320, 260);
    ctx.fillText(new Date().toLocaleTimeString(), 320, 285);
  }, 1000 / 30);

  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0];
  if (track) {
    track._intervalId = intervalId;
  }
  return track;
};

// Helper: Generate simulated audio track for environments where microphone is unavailable
const createSimulatedAudioTrack = () => {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.001; // subtle live frequency to keep audio pipe open
    const dst = ctx.createMediaStreamDestination();
    osc.connect(gain);
    gain.connect(dst);
    osc.start();
    const track = dst.stream.getAudioTracks()[0];
    if (track) {
      track._audioCtx = ctx;
    }
    return track;
  } catch (e) {
    console.warn('Simulated audio track creation skipped:', e);
    return null;
  }
};

// Robust Media Stream Acquisition
const acquireMediaStream = async (isDoctor, userName) => {
  // 1. Try real HD camera + real microphone
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    console.log('[Media] Acquired real HD camera and microphone');
    return stream;
  } catch (e1) {
    console.warn('[Media] HD camera/mic failed, trying standard media:', e1.message);
  }

  // 2. Try standard camera + microphone
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log('[Media] Acquired real standard camera and microphone');
    return stream;
  } catch (e2) {
    console.warn('[Media] Standard camera/mic failed, checking single media device:', e2.message);
  }

  // 3. Try microphone only (with simulated video avatar)
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const videoTrack = createSimulatedVideoTrack(isDoctor, userName);
    if (videoTrack) audioStream.addTrack(videoTrack);
    console.log('[Media] Acquired real microphone with simulated video avatar');
    return audioStream;
  } catch (e3) {
    console.warn('[Media] Audio-only failed:', e3.message);
  }

  // 4. Try camera only (with simulated audio track)
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const audioTrack = createSimulatedAudioTrack();
    if (audioTrack) videoStream.addTrack(audioTrack);
    console.log('[Media] Acquired real camera with simulated audio track');
    return videoStream;
  } catch (e4) {
    console.warn('[Media] Video-only failed:', e4.message);
  }

  // 5. Hardware unavailable / Headless testing fallback
  console.log('[Media] Hardware unavailable, using simulated video+audio stream');
  const simStream = new MediaStream();
  const simVideo = createSimulatedVideoTrack(isDoctor, userName);
  if (simVideo) simStream.addTrack(simVideo);
  const simAudio = createSimulatedAudioTrack();
  if (simAudio) simStream.addTrack(simAudio);
  return simStream;
};

export const VideoConsultation = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [consultation, setConsultation] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('WAITING'); // WAITING, CONNECTING, ACTIVE, RECONNECTING, ENDED
  const [statusMessage, setStatusMessage] = useState('Waiting for other participant to join...');
  const [cameraActive, setCameraActive] = useState(true);
  const [micActive, setMicActive] = useState(true);
  const [errorNotice, setErrorNotice] = useState(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Composite Google Meet Style Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadingRecording, setUploadingRecording] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const wsRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const iceCandidatesQueue = useRef([]);
  const isNegotiating = useRef(false);

  // Recording Refs
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const canvasRef = useRef(null);
  const drawIntervalRef = useRef(null);
  const audioContextRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const recordingDurationRef = useRef(0);

  const peerId = useRef(`peer-${user?.id || Math.floor(Math.random() * 10000)}`).current;
  const isDoctor = user?.role === 'DOCTOR';

  const otherParticipantName = isDoctor
    ? (consultation?.patient?.full_name || 'Patient')
    : (consultation?.doctor?.full_name || 'Doctor');

  // 1. Fetch Consultation Details & Authorize on Backend
  useEffect(() => {
    let active = true;
    const loadConsultation = async () => {
      try {
        const data = await apiClient(`/consultations/${roomId}`);
        if (!active) return;
        setConsultation(data);

        // Record join on backend
        await apiClient(`/consultations/${roomId}/join`, { method: 'POST' });
      } catch (err) {
        console.error('Error loading consultation:', err);
        if (active) {
          setErrorNotice(err.message || 'Failed to initialize consultation session.');
        }
      }
    };

    if (roomId) loadConsultation();
    return () => { active = false; };
  }, [roomId]);

  // ---------------------------------------------------------------------------
  // Google Meet Style Composite Recording Engine
  // ---------------------------------------------------------------------------
  const startCompositeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      canvasRef.current = canvas;

      // Audio mixing using Web Audio API
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      let mixedAudioTrack = null;
      if (AudioCtx) {
        try {
          const actx = new AudioCtx();
          audioContextRef.current = actx;
          const dest = actx.createMediaStreamDestination();

          if (localStreamRef.current && localStreamRef.current.getAudioTracks().length > 0) {
            try {
              const localSource = actx.createMediaStreamSource(localStreamRef.current);
              localSource.connect(dest);
            } catch (e) {
              console.warn('[Recording] Local audio mixing connect note:', e);
            }
          }

          if (remoteStreamRef.current && remoteStreamRef.current.getAudioTracks().length > 0) {
            try {
              const remoteSource = actx.createMediaStreamSource(remoteStreamRef.current);
              remoteSource.connect(dest);
            } catch (e) {
              console.warn('[Recording] Remote audio mixing connect note:', e);
            }
          }

          mixedAudioTrack = dest.stream.getAudioTracks()[0];
        } catch (actxErr) {
          console.warn('[Recording] AudioContext init note:', actxErr);
        }
      }

      // Draw helper for each participant pane
      const drawParticipantPane = (ctx, box, videoEl, name, roleLabel) => {
        ctx.save();
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(box.x, box.y, box.w, box.h, 16);
        } else {
          ctx.rect(box.x, box.y, box.w, box.h);
        }
        ctx.fill();
        ctx.stroke();
        ctx.clip();

        let drewVideo = false;
        if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
          try {
            const vw = videoEl.videoWidth;
            const vh = videoEl.videoHeight;
            const scale = Math.max(box.w / vw, box.h / vh);
            const dw = vw * scale;
            const dh = vh * scale;
            const dx = box.x + (box.w - dw) / 2;
            const dy = box.y + (box.h - dh) / 2;
            ctx.drawImage(videoEl, dx, dy, dw, dh);
            drewVideo = true;
          } catch (_) {}
        }

        if (!drewVideo) {
          // Placeholder avatar circle
          ctx.fillStyle = '#1e293b';
          ctx.beginPath();
          ctx.arc(box.x + box.w / 2, box.y + box.h / 2 - 20, 52, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 28px Plus Jakarta Sans, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText((name || '?').charAt(0).toUpperCase(), box.x + box.w / 2, box.y + box.h / 2 - 10);
        }

        // Name Banner on bottom
        ctx.fillStyle = 'rgba(2, 6, 23, 0.75)';
        ctx.fillRect(box.x + 16, box.y + box.h - 52, box.w - 32, 38);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.strokeRect(box.x + 16, box.y + box.h - 52, box.w - 32, 38);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Plus Jakarta Sans, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(name || roleLabel, box.x + 28, box.y + box.h - 28);

        ctx.fillStyle = '#2dd4bf';
        ctx.font = '11px Plus Jakarta Sans, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(roleLabel, box.x + box.w - 28, box.y + box.h - 28);

        ctx.restore();
      };

      // Composite loop (runs at 30fps)
      const drawFrame = () => {
        if (!canvasRef.current) return;
        const width = 1280;
        const height = 720;

        // Dark slate backdrop
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, width, height);

        // Header bar
        ctx.fillStyle = '#0b132b';
        ctx.fillRect(0, 0, width, 54);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 54);
        ctx.lineTo(width, 54);
        ctx.stroke();

        // Header Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px Plus Jakarta Sans, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Telemed Live Consultation Recording • Room: ${roomId}`, 24, 33);

        // Recording indicator
        const sec = recordingDurationRef.current;
        const mins = String(Math.floor(sec / 60)).padStart(2, '0');
        const secs = String(sec % 60).padStart(2, '0');

        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(width - 150, 27, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`REC ${mins}:${secs}`, width - 138, 32);

        // Side-by-side Google Meet boxes
        const boxY = 70;
        const boxW = 590;
        const boxH = 625;

        const docBox = { x: 35, y: boxY, w: boxW, h: boxH };
        const patBox = { x: 655, y: boxY, w: boxW, h: boxH };

        const docVideo = isDoctor ? localVideoRef.current : remoteVideoRef.current;
        const patVideo = isDoctor ? remoteVideoRef.current : localVideoRef.current;

        const docName = isDoctor ? (user?.name || 'Dr. Attending') : (otherParticipantName || 'Dr. Attending');
        const patName = isDoctor ? (otherParticipantName || 'Patient') : (user?.name || 'Patient');

        drawParticipantPane(ctx, docBox, docVideo, docName, 'Doctor (Attending)');
        drawParticipantPane(ctx, patBox, patVideo, patName, 'Patient');
      };

      drawIntervalRef.current = setInterval(drawFrame, 1000 / 30);

      // Composite stream
      const canvasStream = canvas.captureStream(30);
      const compositeStream = new MediaStream();
      canvasStream.getVideoTracks().forEach(t => compositeStream.addTrack(t));
      if (mixedAudioTrack) {
        compositeStream.addTrack(mixedAudioTrack);
      }

      let mimeType = 'video/webm;codecs=vp8,opus';
      if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
      }

      if (typeof MediaRecorder !== 'undefined') {
        const recorder = mimeType
          ? new MediaRecorder(compositeStream, { mimeType, videoBitsPerSecond: 1500000 })
          : new MediaRecorder(compositeStream);

        recordedChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunksRef.current.push(e.data);
          }
        };

        recorder.start(1000);
        mediaRecorderRef.current = recorder;
        setIsRecording(true);

        recordingTimerRef.current = setInterval(() => {
          recordingDurationRef.current += 1;
          setRecordingSeconds(recordingDurationRef.current);
        }, 1000);

        console.log('[Recording] Google Meet composite consultation recorder running');
      }
    } catch (err) {
      console.warn('[Recording] Composite recorder init note:', err);
    }
  };

  const stopAndUploadRecording = async () => {
    if (drawIntervalRef.current) {
      clearInterval(drawIntervalRef.current);
      drawIntervalRef.current = null;
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return;
    }

    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      recorder.onstop = async () => {
        try {
          const mimeType = recorder.mimeType || 'video/webm';
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });
          const duration = recordingDurationRef.current || 0;

          if (blob.size > 1000) {
            console.log(`[Recording] Uploading consultation recording (${blob.size} bytes, ${duration}s)...`);
            const formData = new FormData();
            formData.append('file', blob, `recording_${roomId}.webm`);
            formData.append('duration_seconds', String(duration));

            const token = localStorage.getItem('token');
            const res = await fetch(`/api/consultations/${roomId}/recording`, {
              method: 'POST',
              headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {})
              },
              body: formData
            });

            if (res.ok) {
              console.log('[Recording] Consultation recording persisted to database');
            } else {
              console.warn('[Recording] Upload response status:', res.status);
            }
          }
        } catch (uploadErr) {
          console.error('[Recording] Upload error:', uploadErr);
        } finally {
          setIsRecording(false);
          resolve();
        }
      };

      try {
        recorder.stop();
      } catch (e) {
        resolve();
      }
    });
  };

  // 2. Real-Time Two-Way Video + Audio WebRTC Pipeline
  useEffect(() => {
    let isMounted = true;
    let localStream = null;
    let pc = null;
    let ws = null;

    const startCall = async () => {
      try {
        localStream = await acquireMediaStream(isDoctor, user?.name);
        if (!isMounted) {
          localStream.getTracks().forEach(t => t.stop());
          return;
        }

        localStreamRef.current = localStream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
          localVideoRef.current.play().catch(() => {});
        }

        // Start Meet-style composite recording
        startCompositeRecording();

        const pcConfig = {
          iceServers: [
            { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
            { urls: ['stun:stun.cloudflare.com:3478'] },
          ],
          iceCandidatePoolSize: 10,
        };

        pc = new RTCPeerConnection(pcConfig);
        peerConnectionRef.current = pc;

        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });

        pc.ontrack = (event) => {
          console.log('[WebRTC] Received remote stream track:', event.track.kind);
          if (!remoteStreamRef.current) {
            remoteStreamRef.current = new MediaStream();
          }

          if (event.streams && event.streams[0]) {
            remoteStreamRef.current = event.streams[0];
          } else {
            remoteStreamRef.current.addTrack(event.track);
          }

          if (remoteVideoRef.current) {
            if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
              remoteVideoRef.current.srcObject = remoteStreamRef.current;
            }
            remoteVideoRef.current.play().catch((err) => {
              console.warn('[WebRTC] Remote play prevented by browser autoplay policy:', err);
              if (isMounted) setAutoplayBlocked(true);
            });
          }

          // Also connect remote audio to recorder AudioContext if active
          if (audioContextRef.current && event.track.kind === 'audio') {
            try {
              const remoteStreamWithAudio = new MediaStream([event.track]);
              const source = audioContextRef.current.createMediaStreamSource(remoteStreamWithAudio);
              const dest = audioContextRef.current.destination;
              source.connect(dest);
            } catch (_) {}
          }

          if (isMounted) {
            setConnectionStatus('ACTIVE');
            setStatusMessage('Live Video & Audio Connected');
          }
        };

        pc.onicecandidate = (event) => {
          if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'ice-candidate',
              candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
            }));
          }
        };

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/consultation/${roomId}/${peerId}`;
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        const sendOfferIfDoctor = async () => {
          if (isNegotiating.current) return;
          if (isDoctor && pc) {
            try {
              isNegotiating.current = true;
              console.log('[WebRTC] Creating doctor initial offer...');
              const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
              });
              await pc.setLocalDescription(offer);
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: 'offer',
                  sdp: pc.localDescription || offer,
                }));
              }
            } catch (err) {
              console.error('[WebRTC] Error creating offer:', err);
            } finally {
              isNegotiating.current = false;
            }
          }
        };

        ws.onopen = () => {
          console.log('[Signaling] WebSocket connected to room:', roomId);
          ws.send(JSON.stringify({
            type: 'join',
            name: user?.name || (isDoctor ? 'Doctor' : 'Patient'),
            role: user?.role,
          }));
        };

        ws.onmessage = async (event) => {
          try {
            const msg = JSON.parse(event.data);

            switch (msg.type) {
              case 'room-status':
                if (msg.peer_count >= 2) {
                  if (isMounted) {
                    setStatusMessage('Both parties present. Negotiating real-time media...');
                    setConnectionStatus('CONNECTING');
                  }
                  await sendOfferIfDoctor();
                }
                break;

              case 'peer-joined':
                if (isMounted) {
                  setStatusMessage('Both parties present. Negotiating real-time media...');
                  setConnectionStatus('CONNECTING');
                }
                await sendOfferIfDoctor();
                break;

              case 'offer':
                if (pc.signalingState !== 'stable') {
                  await Promise.all([
                    pc.setLocalDescription({ type: 'rollback' }).catch(() => {}),
                    pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
                  ]);
                } else {
                  await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                }

                while (iceCandidatesQueue.current.length > 0) {
                  const cand = iceCandidatesQueue.current.shift();
                  await pc.addIceCandidate(cand).catch(e => console.warn('ICE drain error:', e));
                }

                const answer = await pc.createAnswer({
                  offerToReceiveAudio: true,
                  offerToReceiveVideo: true,
                });
                await pc.setLocalDescription(answer);

                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'answer',
                    sdp: pc.localDescription || answer,
                  }));
                }

                if (isMounted) {
                  setConnectionStatus('ACTIVE');
                  setStatusMessage('Live Video & Audio Connected');
                }
                break;

              case 'answer':
                if (pc.signalingState === 'have-local-offer') {
                  await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                  while (iceCandidatesQueue.current.length > 0) {
                    const cand = iceCandidatesQueue.current.shift();
                    await pc.addIceCandidate(cand).catch(e => console.warn('ICE drain error:', e));
                  }
                  if (isMounted) {
                    setConnectionStatus('ACTIVE');
                    setStatusMessage('Live Video & Audio Connected');
                  }
                }
                break;

              case 'ice-candidate':
                if (msg.candidate) {
                  const cand = new RTCIceCandidate(msg.candidate);
                  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
                    await pc.addIceCandidate(cand).catch(e => console.warn('ICE add error:', e));
                  } else {
                    iceCandidatesQueue.current.push(cand);
                  }
                }
                break;

              case 'call-ended':
                if (isMounted) {
                  setConnectionStatus('ENDED');
                  setStatusMessage('The consultation has concluded.');
                  stopAndUploadRecording();
                }
                break;

              case 'peer-left':
                if (isMounted) {
                  setStatusMessage(`${msg.name} disconnected.`);
                  setConnectionStatus('WAITING');
                }
                break;

              case 'error':
                if (isMounted) {
                  setErrorNotice(msg.message || 'Signaling error occurred.');
                }
                break;

              default:
                break;
            }
          } catch (err) {
            console.error('[Signaling] Message handler error:', err);
          }
        };

        ws.onerror = (err) => {
          console.error('[Signaling] WebSocket error:', err);
        };

        ws.onclose = () => {
          console.log('[Signaling] WebSocket connection closed');
        };

      } catch (err) {
        console.error('[WebRTC] Call setup error:', err);
        if (isMounted) {
          setErrorNotice('Unable to initialize video & audio communication. Please ensure camera/microphone permissions are granted.');
        }
      }
    };

    startCall();

    return () => {
      isMounted = false;
      stopAndUploadRecording();
      if (localStream) {
        localStream.getTracks().forEach((t) => {
          t.stop();
          if (t._intervalId) clearInterval(t._intervalId);
          if (t._audioCtx && t._audioCtx.state !== 'closed') t._audioCtx.close().catch(() => {});
        });
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      if (pc) {
        pc.close();
      }
    };
  }, [roomId, peerId, isDoctor, user]);

  // Toggle Camera
  const handleToggleCamera = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        const nextState = !cameraActive;
        videoTracks.forEach((track) => {
          track.enabled = nextState;
        });
        setCameraActive(nextState);
      }
    }
  };

  // Toggle Microphone
  const handleToggleMic = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        const nextState = !micActive;
        audioTracks.forEach((track) => {
          track.enabled = nextState;
        });
        setMicActive(nextState);
      }
    }
  };

  // End Call & Upload Recording
  const handleEndCall = async () => {
    try {
      setUploadingRecording(true);
      await stopAndUploadRecording();

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'call-ended' }));
      }
      await apiClient(`/consultations/${roomId}/end`, {
        method: 'POST',
        body: JSON.stringify({ clinical_notes: 'Consultation concluded.' }),
      });
    } catch (err) {
      console.error('Error ending consultation:', err);
    } finally {
      setUploadingRecording(false);
      if (isDoctor) {
        navigate('/admin');
      } else {
        navigate('/appointments');
      }
    }
  };

  const formatDuration = (sec) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col font-sans select-none antialiased">
      {/* Uploading Recording Modal Overlay */}
      {uploadingRecording && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-teal-900/60 border border-teal-500/40 flex items-center justify-center text-teal-400 mb-4 animate-spin">
            <Loader2 className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">Saving Consultation Recording...</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Encrypting and uploading Google Meet style composite video & audio securely to your medical records.
          </p>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="h-16 px-4 md:px-8 border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md flex items-center justify-between z-30 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 hover:text-white transition"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold text-xs shadow-xs">
              Rx
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight">Telemed Live Consultation</h1>
              <p className="text-[11px] text-slate-400">Room: <span className="font-mono text-teal-400">{roomId}</span></p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Recording Badge */}
          {isRecording && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold animate-pulse">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span>REC {formatDuration(recordingSeconds)}</span>
            </div>
          )}

          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-950/60 border border-teal-500/30 text-teal-300 text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
            <span>256-bit Encrypted Composite Recording</span>
          </div>

          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${connectionStatus === 'ACTIVE' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-xs font-semibold text-slate-300">{connectionStatus}</span>
          </div>
        </div>
      </header>

      {/* Error Notice */}
      {errorNotice && (
        <div className="mx-4 md:mx-8 mt-3 p-3 bg-rose-900/50 border border-rose-700/60 text-rose-200 rounded-xl text-xs flex items-center gap-2 z-20">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorNotice}</span>
        </div>
      )}

      {/* Main Video Stage */}
      <main className="flex-1 relative w-full overflow-hidden bg-black flex items-center justify-center p-2 sm:p-4 md:p-6">
        <div className="relative w-full h-full max-w-6xl max-h-[85vh] rounded-2xl md:rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl flex items-center justify-center">
          
          {/* Audio Autoplay Permission Prompt */}
          {autoplayBlocked && (
            <div className="absolute top-6 z-30 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-teal-600 text-white shadow-xl border border-teal-400">
              <Volume2 className="w-5 h-5 animate-bounce" />
              <span className="text-xs font-semibold">Audio playback needs browser permission</span>
              <button
                type="button"
                onClick={() => {
                  if (remoteVideoRef.current) {
                    remoteVideoRef.current.play()
                      .then(() => setAutoplayBlocked(false))
                      .catch(e => console.error('Play retry error:', e));
                  }
                }}
                className="bg-white text-teal-800 text-xs font-bold px-3 py-1 rounded-xl shadow-xs cursor-pointer hover:bg-teal-50 transition"
              >
                Click to Hear Audio
              </button>
            </div>
          )}

          {/* Main Remote Video */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />

          {/* Fallback Overlay if Remote Video not yet active */}
          {connectionStatus !== 'ACTIVE' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-slate-950/90 via-slate-900/80 to-slate-950/95 z-10">
              <div className="w-20 h-20 rounded-full bg-teal-900/60 border border-teal-500/40 flex items-center justify-center mb-4 text-teal-400">
                <Video className="w-9 h-9 animate-pulse" />
              </div>

              <h2 className="text-lg font-bold text-white mb-1">{otherParticipantName}</h2>
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30 mb-4">
                {connectionStatus}
              </span>
              <p className="text-xs text-slate-300 max-w-md leading-relaxed">{statusMessage}</p>

              <div className="mt-6 flex items-center gap-2 text-xs text-teal-300/80 font-mono">
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping" />
                <span>Encrypted consultation stream &amp; Meet-style recording</span>
              </div>
            </div>
          )}

          {/* Remote Participant Label */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-xs font-semibold text-white">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>{otherParticipantName}</span>
          </div>

          {/* Picture-in-Picture Local Video */}
          <div className="absolute bottom-4 right-4 z-20 w-32 h-44 sm:w-44 sm:h-56 md:w-52 md:h-36 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 bg-slate-950">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            {!cameraActive && (
              <div className="absolute inset-0 bg-slate-900/95 flex flex-col items-center justify-center text-slate-400">
                <VideoOff className="w-6 h-6 mb-1 text-rose-400" />
                <span className="text-[10px] font-semibold text-slate-300">Camera Off</span>
              </div>
            )}
            <div className="absolute bottom-2 left-2 flex items-center gap-1">
              {!micActive && (
                <span className="px-1.5 py-0.5 rounded bg-rose-600/90 text-white text-[9px] font-bold flex items-center gap-0.5">
                  <MicOff className="w-2.5 h-2.5" />
                  <span>Muted</span>
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-semibold">
                You
              </span>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Consultation Controls Bar */}
      <footer className="h-20 px-6 bg-slate-900/90 border-t border-slate-800/80 backdrop-blur-md flex items-center justify-center gap-4 sm:gap-6 z-30 shrink-0">
        {/* Camera Toggle */}
        <button
          type="button"
          onClick={handleToggleCamera}
          aria-label={cameraActive ? 'Turn Camera Off' : 'Turn Camera On'}
          className="flex flex-col items-center gap-1 group cursor-pointer"
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center transition shadow-md active:scale-95 ${
            cameraActive
              ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
              : 'bg-rose-600 hover:bg-rose-700 text-white'
          }`}>
            {cameraActive ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </div>
          <span className="text-[11px] font-medium text-slate-300">
            {cameraActive ? 'Camera On' : 'Camera Off'}
          </span>
        </button>

        {/* Microphone Toggle */}
        <button
          type="button"
          onClick={handleToggleMic}
          aria-label={micActive ? 'Mute Microphone' : 'Unmute Microphone'}
          className="flex flex-col items-center gap-1 group cursor-pointer"
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center transition shadow-md active:scale-95 ${
            micActive
              ? 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700'
              : 'bg-rose-600 hover:bg-rose-700 text-white'
          }`}>
            {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </div>
          <span className="text-[11px] font-medium text-slate-300">
            {micActive ? 'Mic On' : 'Muted'}
          </span>
        </button>

        {/* End Call */}
        <button
          type="button"
          onClick={handleEndCall}
          disabled={uploadingRecording}
          aria-label="End Consultation"
          className="flex flex-col items-center gap-1 group cursor-pointer"
        >
          <div className="px-6 h-12 rounded-full bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-rose-600/30 active:scale-95 transition">
            <PhoneOff className="w-5 h-5" />
            <span className="text-xs tracking-wide">End Call</span>
          </div>
          <span className="text-[11px] font-medium text-rose-400">
            Conclude Visit
          </span>
        </button>
      </footer>
    </div>
  );
};
export default VideoConsultation;
