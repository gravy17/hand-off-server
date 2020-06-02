const express = require('express');
const socketio = require('socket.io');
const http = require('http');
const cors = require('cors');

const PORT = process.env.PORT||8989;
const app = express();
const router = express.Router();
router.get('/', (req, res) => {
	res.send('server is live =)');
})

var server = http.createServer(app);

var p2p = require('socket.io-p2p-server').Server;
var io = socketio(server);

const DEFAULT_ROOM = '8e1286c5-407c-4ffd-bf6c-7bc621fb2f2e';

app.use(router);
app.use(cors());

server.listen(PORT, ()=>{
	console.log("Server: "+PORT+"\n\n"+JSON.stringify(server));
})

io.use(p2p);

io.on('connection', (ws) => {
	console.log('new client...');
	let clientId
	let name
	ws.on('hello', (data) => {
		clientId = data.id;
		name = data.name;
		console.log("hello from"+name);
		ws.broadcast.emit('peer-msg', {type: 'REGISTER_USR', id: clientId, name: data.name})
	})

	ws.on('peer-msg', (data) => {
		console.log(JSON.stringify(data));
		ws.broadcast.emit('peer-msg', data)
	})

	ws.on('disconnect', () => {
		console.log("bye from"+name)
		ws.broadcast.emit('peer-msg', {type: 'REMOVE_USR', id: clientId})
		ws.broadcast.emit('peer-msg', {type: 'RM_FROM_ROOMS', name: name})
	})
})
