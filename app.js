const express = require('express');
const socketio = require('socket.io');
const http = require('http');
const cors = require('cors');

const PORT = process.env.PORT||8989;
const app = express();
const router = express.Router();
router.get('/', (req, res) => {
	res.send('HandOff server is live =)');
})
app.use(router);
app.use(cors());

var server = http.createServer(app);

var p2p = require('socket.io-p2p-server').Server;
var io = socketio(server);
io.use(p2p);

const DEFAULT_ROOM = '8e1286c5-407c-4ffd-bf6c-7bc621fb2f2e';
let users = [];
const peerlist = {};

server.listen(PORT, ()=>{
	console.log("Server: "+PORT+"\n\n"+JSON.stringify(server));
})

io.on('connection', (ws) => {
	console.log('new client...\n');
	let clientId
	let name
	if (!peerlist[ws.id]){
		peerlist[ws.id] = ws.id;
	}
	ws.emit("yourID", ws.id);
	io.sockets.emit("allUsers", peerlist);

	ws.on("callUser", (data) => {
		io.to(data.userToCall).emit('hey', {signal: data.signalData, from: data.from});
	})

	ws.on("acceptCall", (data) => {
		io.to(data.to).emit('callAccepted', data.signal);
	})

	ws.on('hello', (data) => {
		clientId = data.id;
		name = data.name;
		users.push({id: clientId, name: name});
		console.log("hello from "+name);
		ws.broadcast.emit('peer-msg', {type: 'REGISTER_USR', id: clientId, name: name})
		users.forEach(user => {
			ws.emit('peer-msg', {type: 'REGISTER_USR', id: user.id, name: user.name})
		})
	})

	ws.on('peer-msg', (data) => {
		console.log(name+"\'s socket just sent an action through the server");
		ws.broadcast.emit('peer-msg', data)
	})

	ws.on('disconnect', () => {
		console.log("bye from "+name);
		users = users.filter(usr => usr.id !== clientId);
		console.log("Remaining users: \n"+users);
		delete peerlist[ws.id];
		ws.broadcast.emit('peer-msg', {type: 'REMOVE_USR', id: clientId})
		ws.broadcast.emit('peer-msg', {type: 'RM_FROM_ROOMS', name: name})
	})
})
