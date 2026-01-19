'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { VideoCallRoom } from '@/types/prescription';

// ICEサーバー設定（STUN）
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

// ポーリング間隔（ミリ秒）
const POLLING_INTERVAL = 1000;

type ConnectionStatus = 'initializing' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'error';

export default function VideoCallPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.roomId as string;
  const role = searchParams.get('role') as 'store' | 'customer' || 'customer';

  const [room, setRoom] = useState<VideoCallRoom | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const processedCandidatesRef = useRef<Set<string>>(new Set());

  // ルーム情報を取得
  const fetchRoom = useCallback(async () => {
    try {
      const response = await fetch(`/api/video-call/${roomId}`);
      const data = await response.json();
      
      if (data.success) {
        setRoom(data.data);
        return data.data as VideoCallRoom;
      } else {
        if (data.error === 'Room not found') {
          setError('通話ルームが見つかりません。リンクの有効期限が切れている可能性があります。');
          setConnectionStatus('error');
        }
        return null;
      }
    } catch (err) {
      console.error('Error fetching room:', err);
      return null;
    }
  }, [roomId]);

  // ローカルメディアストリームを取得
  const getLocalStream = async () => {
    try {
      // まずデバイスが利用可能かチェック
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideo = devices.some(device => device.kind === 'videoinput');
      const hasAudio = devices.some(device => device.kind === 'audioinput');
      
      console.log('[VideoCall] Available devices:', {
        video: hasVideo,
        audio: hasAudio,
        devices: devices.map(d => ({ kind: d.kind, label: d.label || '(ラベルなし)' }))
      });

      if (!hasVideo && !hasAudio) {
        setError('カメラとマイクが見つかりません。デバイスが正しく接続されているか確認してください。');
        setConnectionStatus('error');
        return null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: hasVideo,
        audio: hasAudio,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      console.log('[VideoCall] Media stream obtained successfully');
      return stream;
    } catch (err: unknown) {
      console.error('[VideoCall] Error accessing media devices:', err);
      
      // エラーの種類に応じて詳細なメッセージを表示
      let errorMessage = 'カメラとマイクへのアクセスに失敗しました。';
      
      if (err instanceof Error) {
        const errorName = err.name;
        console.error('[VideoCall] Error name:', errorName, 'Message:', err.message);
        
        switch (errorName) {
          case 'NotAllowedError':
          case 'PermissionDeniedError':
            errorMessage = 'カメラとマイクの使用が許可されていません。\n\n' +
              '【確認事項】\n' +
              '1. ブラウザのアドレスバー左のカメラアイコンをクリックして許可してください\n' +
              '2. Windowsの場合: 設定 → プライバシー → カメラ/マイク で許可されているか確認\n' +
              '3. 他のアプリ（Zoom、Teams等）がカメラを使用していないか確認';
            break;
          case 'NotFoundError':
          case 'DevicesNotFoundError':
            errorMessage = 'カメラまたはマイクが見つかりません。デバイスが正しく接続されているか確認してください。';
            break;
          case 'NotReadableError':
          case 'TrackStartError':
            errorMessage = 'カメラまたはマイクにアクセスできません。\n\n' +
              '【考えられる原因】\n' +
              '・他のアプリケーション（Zoom、Teams、Skype等）がカメラを使用中\n' +
              '・デバイスドライバーの問題\n\n' +
              '他のビデオ通話アプリを終了してから再度お試しください。';
            break;
          case 'OverconstrainedError':
            errorMessage = 'カメラの設定に問題があります。別のカメラをお試しください。';
            break;
          case 'SecurityError':
            errorMessage = 'セキュリティエラーが発生しました。HTTPSで接続しているか確認してください。';
            break;
          default:
            errorMessage = `カメラとマイクへのアクセスに失敗しました。\n\nエラー: ${errorName}\n${err.message}`;
        }
      }
      
      setError(errorMessage);
      setConnectionStatus('error');
      return null;
    }
  };

  // WebRTC接続を初期化
  const initializePeerConnection = useCallback((stream: MediaStream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    
    // ローカルストリームのトラックを追加
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // リモートストリームを受信
    pc.ontrack = (event) => {
      console.log('Remote track received:', event.track.kind);
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // ICE Candidate を収集
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        const candidateString = JSON.stringify(event.candidate);
        console.log('ICE Candidate:', candidateString.slice(0, 100));
        
        try {
          await fetch(`/api/video-call/${roomId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: role === 'store' ? 'addStoreCandidate' : 'addCustomerCandidate',
              candidate: candidateString,
            }),
          });
        } catch (err) {
          console.error('Error sending ICE candidate:', err);
        }
      }
    };

    // 接続状態の変化
    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      switch (pc.connectionState) {
        case 'connected':
          setConnectionStatus('connected');
          callStartTimeRef.current = Date.now();
          break;
        case 'disconnected':
        case 'failed':
          setConnectionStatus('disconnected');
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE Connection state:', pc.iceConnectionState);
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [roomId, role]);

  // 店舗側: オファーを作成して送信
  const createOffer = useCallback(async (pc: RTCPeerConnection) => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await fetch(`/api/video-call/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setOffer',
          offer: JSON.stringify(offer),
        }),
      });
      
      setConnectionStatus('waiting');
      console.log('Offer created and sent');
    } catch (err) {
      console.error('Error creating offer:', err);
      setError('通話の開始に失敗しました');
      setConnectionStatus('error');
    }
  }, [roomId]);

  // お客様側: アンサーを作成して送信
  const createAnswer = useCallback(async (pc: RTCPeerConnection, offerSdp: string) => {
    try {
      const offer = JSON.parse(offerSdp);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      await fetch(`/api/video-call/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setAnswer',
          answer: JSON.stringify(answer),
        }),
      });
      
      setConnectionStatus('connecting');
      console.log('Answer created and sent');
    } catch (err) {
      console.error('Error creating answer:', err);
      setError('通話への接続に失敗しました');
      setConnectionStatus('error');
    }
  }, [roomId]);

  // ICE Candidatesを処理
  const processCandidates = useCallback(async (pc: RTCPeerConnection, candidates: string[]) => {
    for (const candidateStr of candidates) {
      if (processedCandidatesRef.current.has(candidateStr)) continue;
      
      try {
        const candidate = JSON.parse(candidateStr);
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        processedCandidatesRef.current.add(candidateStr);
        console.log('Added ICE candidate');
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  }, []);

  // ポーリングでルーム状態を監視
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;

    pollingIntervalRef.current = setInterval(async () => {
      const roomData = await fetchRoom();
      if (!roomData || !peerConnectionRef.current) return;

      const pc = peerConnectionRef.current;

      // 店舗側: アンサーを待つ
      if (role === 'store' && roomData.answer && !pc.remoteDescription) {
        try {
          const answer = JSON.parse(roomData.answer);
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          setConnectionStatus('connecting');
          console.log('Answer received and set');
        } catch (err) {
          console.error('Error setting answer:', err);
        }
      }

      // ICE Candidatesを処理
      const candidates = role === 'store' 
        ? roomData.customerCandidates || []
        : roomData.storeCandidates || [];
      
      if (candidates.length > 0) {
        await processCandidates(pc, candidates);
      }

      // 通話終了チェック
      if (roomData.status === 'ended') {
        handleEndCall();
      }
    }, POLLING_INTERVAL);
  }, [fetchRoom, role, processCandidates]);

  // 通話を終了
  const handleEndCall = useCallback(async () => {
    // ポーリングを停止
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // メディアストリームを停止
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }

    // PeerConnectionを閉じる
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    // サーバーに終了を通知
    try {
      await fetch(`/api/video-call/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'endCall' }),
      });
    } catch (err) {
      console.error('Error ending call:', err);
    }

    setConnectionStatus('disconnected');
  }, [roomId]);

  // ミュート切り替え
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // ビデオ切り替え
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  // 通話時間を更新
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (connectionStatus === 'connected' && callStartTimeRef.current) {
      timer = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current!) / 1000));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [connectionStatus]);

  // 初期化
  useEffect(() => {
    const initialize = async () => {
      // ルーム情報を取得
      const roomData = await fetchRoom();
      if (!roomData) return;

      // メディアストリームを取得
      const stream = await getLocalStream();
      if (!stream) return;

      // PeerConnectionを初期化
      const pc = initializePeerConnection(stream);

      if (role === 'store') {
        // 店舗側: オファーを作成
        await createOffer(pc);
      } else {
        // お客様側: オファーがあればアンサーを作成
        if (roomData.offer) {
          await createAnswer(pc, roomData.offer);
        } else {
          setConnectionStatus('waiting');
        }
      }

      // ポーリング開始
      startPolling();
    };

    initialize();

    return () => {
      // クリーンアップ
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  // 通話時間をフォーマット
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* ヘッダー */}
      <header className="bg-gray-800 text-white p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gacky-green rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="font-semibold">オンライン服薬指導</h1>
            <p className="text-sm text-gray-400">
              {role === 'store' ? room?.userDisplayName || 'お客様' : room?.storeName || 'あおぞら薬局'}
              との通話
            </p>
          </div>
        </div>
        {connectionStatus === 'connected' && (
          <div className="flex items-center space-x-2 text-green-400">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            <span className="text-sm font-mono">{formatDuration(callDuration)}</span>
          </div>
        )}
      </header>

      {/* メインコンテンツ */}
      <main className="flex-1 relative">
        {/* エラー表示 */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
            <div className="text-center p-8 max-w-md">
              <div className="w-16 h-16 mx-auto mb-4 bg-red-500 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-white text-xl font-semibold mb-4">エラーが発生しました</h2>
              <div className="text-gray-400 mb-6 text-left whitespace-pre-line bg-gray-800 p-4 rounded-lg text-sm">
                {error}
              </div>
              <div className="flex justify-center space-x-3">
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-gacky-green text-white rounded-lg hover:bg-green-600"
                >
                  再試行
                </button>
                <button
                  onClick={() => window.close()}
                  className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 接続待ち表示 */}
        {(connectionStatus === 'initializing' || connectionStatus === 'waiting') && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
            <div className="text-center p-8">
              <div className="w-16 h-16 mx-auto mb-4 border-4 border-gacky-green border-t-transparent rounded-full animate-spin"></div>
              <h2 className="text-white text-xl font-semibold mb-2">
                {connectionStatus === 'initializing' ? '準備中...' : '相手の参加を待っています...'}
              </h2>
              <p className="text-gray-400">
                {role === 'store' 
                  ? 'お客様がビデオ通話に参加するのをお待ちください'
                  : '薬剤師が通話を開始するのをお待ちください'}
              </p>
            </div>
          </div>
        )}

        {/* 通話終了表示 */}
        {connectionStatus === 'disconnected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
            <div className="text-center p-8">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-600 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
                </svg>
              </div>
              <h2 className="text-white text-xl font-semibold mb-2">通話が終了しました</h2>
              <p className="text-gray-400 mb-6">
                通話時間: {formatDuration(callDuration)}
              </p>
              <button
                onClick={() => window.close()}
                className="px-6 py-2 bg-gacky-green text-white rounded-lg hover:bg-green-600"
              >
                閉じる
              </button>
            </div>
          </div>
        )}

        {/* ビデオ表示エリア */}
        <div className="h-full flex flex-col md:flex-row">
          {/* リモートビデオ（メイン） */}
          <div className="flex-1 relative bg-gray-800">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {connectionStatus !== 'connected' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-24 h-24 bg-gray-700 rounded-full flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* ローカルビデオ（小窓） */}
          <div className="absolute bottom-24 right-4 w-32 h-24 md:w-48 md:h-36 bg-gray-700 rounded-lg overflow-hidden shadow-lg">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {isVideoOff && (
              <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* コントロールバー */}
      <footer className="bg-gray-800 p-4">
        <div className="flex items-center justify-center space-x-4">
          {/* ミュートボタン */}
          <button
            onClick={toggleMute}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-600 hover:bg-gray-500'
            }`}
          >
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>

          {/* ビデオON/OFFボタン */}
          <button
            onClick={toggleVideo}
            className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
              isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-600 hover:bg-gray-500'
            }`}
          >
            {isVideoOff ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>

          {/* 通話終了ボタン */}
          <button
            onClick={handleEndCall}
            className="w-14 h-14 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
