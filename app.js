const WebSocket = require('ws')

const wss = new WebSocket.Server({ port: process.env.PORT||8000})
const DEFAULT_ROOM = '8e1286c5-407c-4ffd-bf6c-7bc621fb2f2e';
const users = []
const onlineUsers = []
const clients = []
const rooms = []

const broadcast = (data, ws) => {
	if (ws === null){
		wss.clients.forEach((client) => {
				client.send(JSON.stringify(data))
		})
		return;
	}
	wss.clients.forEach((client) => {
		if (client.readyState === WebSocket.OPEN && client !== ws){
			client.send(JSON.stringify(data))
		}
	})
}

console.log('server running: '+ JSON.stringify(wss));
wss.on('connection', (ws) => {
	console.log('new client...');
	ws.on('message', (message) => {
		const data = JSON.parse(message)
		switch (data.type) {
			case 'REGISTER_USR': {
				if (!users.some( user => (user.id === data.id) && (user.name === data.name)))
					{users.push({ id: data.id, name: data.name})}

				if (onlineUsers.some( user => (user.name === data.name))){
					ws.index = onlineUsers.findIndex(user => (user.name === data.name));
					console.log("User: "+data.name +"\nIndex: "+ ws.index);
					ws.send(JSON.stringify({
						type: 'USERS',
						onlineUsers
					}))
					ws.send(JSON.stringify({
						type: 'USER_ROOMS',
						rooms
					}))
				}
				else{
					ws.index = onlineUsers.length
					onlineUsers.push({ id: data.id, name: data.name})
					console.log("User: "+data.name +"\nIndex: "+ ws.index);
					ws.send(JSON.stringify({
						type: 'USERS',
						onlineUsers
					}))
					broadcast({
						type: 'USERS',
						onlineUsers
					}, ws)
					if(rooms.some( room => room.id === DEFAULT_ROOM)){
					let roomIndex = rooms.findIndex(room => room.id === DEFAULT_ROOM);
					rooms[roomIndex].roomUsers.push(data.name);}
				  else
					{ rooms.push({id: DEFAULT_ROOM, roomName: 'General', roomUsers: [data.name]});
					}
					broadcast({
						type: 'USER_ROOMS',
						rooms
					}, null)
				}
				// console.log(JSON.stringify(rooms));
				break;
			}
			case 'RENAME_USR': {
				let usrindex = users.findIndex(user => user.id === data.id)
				let oldName = users[usrindex].name;
				users[usrindex].name = data.name;

				onlineUsers[ws.index].name = data.name;
				let modrooms = rooms.some(room => room.Users.includes(oldName));
				modrooms.map(room => {var i = room.roomUsers.findIndex(user => user === oldName); room.roomUsers.splice(i, 1, data.name)}
				);

				ws.send(JSON.stringify({
					type: 'USERS',
					onlineUsers
				}))
				broadcast({
					type: 'USERS',
					onlineUsers
				}, ws)
				broadcast({
					type: 'USER_ROOMS',
					rooms
				}, null)
				break;
			}
			case 'OUTGOING_MSG': {
				broadcast({
					type: 'OUTGOING_MSG',
					id: data.id,
					msg: data.msg,
					sender: data.sender,
					roomid: data.roomid
				}, ws)
				break;
			}
			case 'ADD_FEED': {
				console.log("feed added: "+data.sender+ "\nTo:"+data.roomid);
				broadcast({
					type: 'ADD_FEED',
					src: data.src,
					sender: data.sender,
					roomid: data.roomid
				}, ws)
				break;
			}
			case 'JOIN_ROOM': {
				console.log("Room joined: "+data.id+ "\nBy:"+data.newUser);
				let roomIndex = rooms.findIndex(room => room.id === data.id);
				if (roomIndex < 0){
					rooms[roomIndex].roomUsers.push(data.newUser);
				} else { break; }
				broadcast({
					type: 'JOIN_ROOM',
					id: data.id,
					newUser: data.newUser
				}, ws)
				break;
			}
			case 'CREATE_ROOM': {
				console.log("new room: "+data.roomName);
				rooms.push({
					id: data.id,
					roomName: data.roomName,
					roomUsers: data.roomUsers
				})
				broadcast({
					type: 'USER_ROOMS',
					rooms
				}, null)
				// broadcast({
				// 	type: 'CREATE_ROOM',
				// 	id: data.id,
				// 	roomName: data.roomName,
				// 	roomUsers: data.roomUsers
				// }, ws)
				break;
			}
			default:
				break;
		}
	})

	ws.on('close', () => {
		let skip = false;
		wss.clients.forEach((client) => {
			if (ws.index === client.index)
				skip = true;
		})
		if (!skip){
			let usr = onlineUsers.splice(ws.index, 1);
			console.log('we closed: '+ usr[0].name + '\nindex: '+ ws.index)
			let genroom = rooms.find( room =>  room.id === DEFAULT_ROOM
			)
			if(usr[0].name){
			genroom.roomUsers = genroom.roomUsers.filter(user => user !== usr[0].name);}
			wss.clients.forEach((client) => {
				if (ws.index < client.index)
					client.index -= 1 ;
			})
			broadcast({
				type: 'USERS',
				onlineUsers
			}, ws)
			broadcast({
				type: 'USER_ROOMS',
				rooms
			}, ws)
		}
		console.log('Client socket closed.')
	})
})
