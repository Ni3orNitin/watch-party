// Global variables for Firebase, WebRTC, and YouTube player
let app, db, auth;
let userId;
let sessionDocRef;
let player;
// Corrected initialization of RTCPeerConnection
const peerConnection = new RTCPeerConnection({
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
});
let localStream;
let isVideoSyncing = false;
let isHost = false;

// --- Firebase & App Initialization ---
async function initializeFirebase() {
    // Firestore must be initialized with the provided global variables.
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    if (Object.keys(firebaseConfig).length === 0) {
        console.error("Firebase config is missing. Please provide a valid configuration.");
        return;
    }

    try {
        app = firebase.initializeApp(firebaseConfig);
        auth = firebase.auth.getAuth(app);
        db = firebase.firestore.getFirestore(app);
        firebase.firestore.setLogLevel('debug'); // Enable Firestore logging

        if (initialAuthToken) {
            await firebase.auth.signInWithCustomToken(auth, initialAuthToken);
        } else {
            await firebase.auth.signInAnonymously(auth);
        }

        userId = auth.currentUser?.uid || crypto.randomUUID();
        document.getElementById('session-id-display').textContent = userId;
        setupWebRTC();
        setupYouTubePlayer();
        joinParty();
    } catch (error) {
        console.error("Firebase initialization or authentication failed:", error);
    }
}

// --- Watch Party Logic (Firestore) ---
async function joinParty() {
    const partyId = 'default-watch-party'; // Using a fixed ID for simplicity
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    sessionDocRef = firebase.firestore.doc(db, `artifacts/${appId}/public/data/watch-parties/${partyId}`);

    // Check if the document exists to determine if we are the host
    const docSnap = await firebase.firestore.getDoc(sessionDocRef);
    if (!docSnap.exists()) {
        isHost = true;
        console.log("Creating new watch party. You are the host.");
        await firebase.firestore.setDoc(sessionDocRef, {
            videoId: '',
            isPlaying: false,
            lastUpdated: firebase.firestore.serverTimestamp(),
            lastUpdatedBy: userId,
        });
    } else {
        console.log("Joining existing watch party.");
        isHost = false;
    }

    // Real-time listener for video state changes
    firebase.firestore.onSnapshot(sessionDocRef, (doc) => {
        if (doc.exists() && player) {
            const data = doc.data();
            if (data.lastUpdatedBy !== userId && !isVideoSyncing) {
                console.log("Syncing video state from Firestore...");
                if (player.getVideoUrl() && !player.getVideoUrl().includes(data.videoId)) {
                    player.loadVideoById(data.videoId);
                }
                if (data.isPlaying && player.getPlayerState() !== 1) {
                    player.playVideo();
                } else if (!data.isPlaying && player.getPlayerState() === 1) {
                    player.pauseVideo();
                }
                // Simple sync mechanism. A more robust solution would handle time drift.
                const timeDifference = Math.abs(player.getCurrentTime() - data.currentTime);
                if (timeDifference > 2) { // If time difference is > 2 seconds
                    player.seekTo(data.currentTime, true);
                }
            }
        }
    });

    // Listen for changes in the 'chat' sub-collection
    const chatCollectionRef = firebase.firestore.collection(sessionDocRef, "chat");
    const chatQuery = firebase.firestore.query(chatCollectionRef, firebase.firestore.orderBy("timestamp"));
    firebase.firestore.onSnapshot(chatQuery, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const message = change.doc.data();
                displayChatMessage(message.sender, message.text);
            }
        });
    });
}

async function updateVideoState(state) {
    if (sessionDocRef) {
        isVideoSyncing = true;
        await firebase.firestore.updateDoc(sessionDocRef, {
            ...state,
            lastUpdated: firebase.firestore.serverTimestamp(),
            lastUpdatedBy: userId
        });
        setTimeout(() => { isVideoSyncing = false; }, 1000); // Debounce sync updates
    }
}

// --- YouTube Player API ---
function setupYouTubePlayer() {
    // This function creates a script tag to load the IFrame Player API.
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

// This function is called by the YouTube IFrame Player API when it's ready.
window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('youtube-player', {
        height: '100%',
        width: '100%',
        videoId: 'dQw4w9WgXcQ', // Default video
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        },
    });
};

function onPlayerReady(event) {
    console.log("YouTube Player is ready.");
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        updateVideoState({ isPlaying: true, currentTime: player.getCurrentTime() });
    } else if (event.data === YT.PlayerState.PAUSED) {
        updateVideoState({ isPlaying: false, currentTime: player.getCurrentTime() });
    }
}

// Event listeners for the video controls
document.getElementById('load-video-btn').addEventListener('click', () => {
    const url = document.getElementById('youtube-url-input').value;
    const videoId = extractYouTubeId(url);
    if (videoId) {
        updateVideoState({ videoId: videoId });
        player.loadVideoById(videoId);
    } else {
        displayChatMessage('System', 'Invalid YouTube URL or ID.');
    }
});

document.getElementById('play-pause-btn').addEventListener('click', () => {
    if (player.getPlayerState() === YT.PlayerState.PLAYING) {
        player.pauseVideo();
    } else {
        player.playVideo();
    }
});

function extractYouTubeId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/ ]{11})/;
    const match = url.match(regex);
    return (match && match[1]) || url;
}

// --- WebRTC Logic (Simulated Signaling) ---
async function setupWebRTC() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.ontrack = (event) => {
            document.getElementById('remote-video').srcObject = event.streams[0];
        };

        peerConnection.onicecandidate = async (event) => {
            if (event.candidate) {
                const candidateData = {
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                };
                const candidatesCollectionRef = firebase.firestore.collection(sessionDocRef, "candidates");
                await firebase.firestore.addDoc(candidatesCollectionRef, {
                    candidate: candidateData,
                    senderId: userId
                });
            }
        };

        if (isHost) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            await firebase.firestore.setDoc(firebase.firestore.doc(sessionDocRef, 'offer-and-answer', userId), {
                offer: peerConnection.localDescription,
                senderId: userId
            });
        }

        firebase.firestore.onSnapshot(firebase.firestore.collection(sessionDocRef, 'offer-and-answer'), async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                const data = change.doc.data();
                if (change.type === 'added' && data.senderId !== userId) {
                    if (data.offer) {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                        const answer = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answer);
                        await firebase.firestore.setDoc(firebase.firestore.doc(sessionDocRef, 'offer-and-answer', userId), {
                            answer: peerConnection.localDescription,
                            senderId: userId
                        }, { merge: true });
                    } else if (data.answer) {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                    }
                }
            });
        });

        firebase.firestore.onSnapshot(firebase.firestore.collection(sessionDocRef, 'candidates'), (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                const data = change.doc.data();
                if (change.type === 'added' && data.senderId !== userId) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (e) {
                        console.error('Error adding received ICE candidate', e);
                    }
                }
            });
        });

    } catch (error) {
        console.error("Error setting up WebRTC:", error);
    }
}

// --- Chat Logic ---
document.getElementById('send-chat-btn').addEventListener('click', async () => {
    const chatInput = document.getElementById('chat-input');
    const messageText = chatInput.value.trim();
    if (messageText && sessionDocRef) {
        const chatCollectionRef = firebase.firestore.collection(sessionDocRef, "chat");
        await firebase.firestore.addDoc(chatCollectionRef, {
            sender: userId,
            text: messageText,
            timestamp: firebase.firestore.serverTimestamp(),
        });
        chatInput.value = '';
    }
});

function displayChatMessage(sender, text) {
    const chatMessages = document.getElementById('chat-messages');
    const messageElement = document.createElement('div');
    messageElement.classList.add('p-3', 'rounded-xl', 'bg-gray-700');
    messageElement.innerHTML = `<span class="font-bold ${sender === userId ? 'text-blue-400' : 'text-purple-400'}">${sender.substring(0, 8)}...:</span> ${text}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll to bottom
}

// Initialize the app on page load
initializeFirebase();
