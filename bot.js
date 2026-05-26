const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GatewayIntents || GatewayIntentBits.GuildMessages
    ]
});

const fs = require('fs');
const path = require('path');

const DISCONNECTED_FILE = path.join(__dirname, 'disconnected_guilds.json');

// เก็บรายชื่อ Guild ที่ถูก Disconnect (ปิด Monitor) — โหลดจากไฟล์หากมีอยู่
let disconnectedGuilds = new Set();
try {
    if (fs.existsSync(DISCONNECTED_FILE)) {
        const data = fs.readFileSync(DISCONNECTED_FILE, 'utf8');
        disconnectedGuilds = new Set(JSON.parse(data));
    }
} catch (error) {
    console.error('Error loading disconnected guilds file:', error);
}

// บันทึกสถานะลงไฟล์
function saveDisconnectedGuilds() {
    try {
        fs.writeFileSync(DISCONNECTED_FILE, JSON.stringify([...disconnectedGuilds]), 'utf8');
    } catch (error) {
        console.error('Error saving disconnected guilds file:', error);
    }
}

// ฟังก์ชันดึงรายชื่อ Guild (Server) ทั้งหมดที่บอทเข้าร่วมอยู่
async function getGuildsList() {
    const guildsList = [];
    try {
        for (const [guildId, guild] of client.guilds.cache) {
            guildsList.push({
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ size: 128 }) || null,
                memberCount: guild.memberCount,
                rolesCount: guild.roles.cache.size,
                monitored: !disconnectedGuilds.has(guildId)   // ถ้าไม่ได้อยู่ใน disconnected = กำลัง monitor
            });
        }
    } catch (error) {
        // เงียบไว้
    }
    return guildsList;
}

// ฟังก์ชันเปิด/ปิดการ Monitor Guild — toggle ใน disconnectedGuilds set
function toggleGuildMonitoring(guildId) {
    const id = String(guildId); // แปลงให้เป็น string เสมอ
    if (disconnectedGuilds.has(id)) {
        // ปัจจุบันปิดอยู่ → เปิดใหม่
        reconnectGuild(id);
        console.log(`[MONITOR ON] Guild ${id} is now being monitored`);
        return { monitored: true, guildId: id };
    } else {
        // ปัจจุบันเปิดอยู่ → ปิด
        disconnectGuild(id);
        console.log(`[MONITOR OFF] Guild ${id} is now disconnected`);
        return { monitored: false, guildId: id };
    }
}

// ฟังก์ชันเช็คว่า Guild นี้กำลังถูก Monitor อยู่หรือไม่
function isGuildMonitored(guildId) {
    const id = String(guildId); // แปลงให้เป็น string เสมอ ป้องกัน type mismatch
    const monitored = !disconnectedGuilds.has(id);
    if (!monitored) {
        console.log(`[BLOCKED] Guild ${id} is disconnected — event ignored`);
    }
    return monitored;
}

// ตัวช่วย: แปลง guildId เป็น string ก่อนใส่ disconnectedGuilds และบันทึกไฟล์
function disconnectGuild(guildId) {
    disconnectedGuilds.add(String(guildId));
    saveDisconnectedGuilds();
}
function reconnectGuild(guildId) {
    disconnectedGuilds.delete(String(guildId));
    saveDisconnectedGuilds();
}

// ฟังก์ชันดึงรายชื่อ Role ทั้งหมด
async function getRolesList() {
    const rolesList = [];
    try {
        const guilds = client.guilds.cache;
        await Promise.all(Array.from(guilds.values()).map(async (guild) => {
            try {
                const roles = await guild.roles.fetch();
                roles.forEach(role => {
                    rolesList.push({
                        guildId: guild.id,
                        guildName: guild.name,
                        id: role.id,
                        name: role.name,
                        color: role.hexColor,
                        position: role.rawPosition,
                        permissions: role.permissions.bitfield.toString()
                    });
                });
            } catch (err) {
                console.error(`Error fetching roles for guild ${guild.name}:`, err);
            }
        }));
    } catch (error) {
        // เงียบไว้
    }
    return rolesList.sort((a, b) => b.position - a.position);
}

// ฟังก์ชันส่ง Webhook แจ้งเตือนอัปเดตแบบ Real-time ไปยัง Backend อื่น
async function triggerWebhook(eventName, payloadData = {}, guildId = null) {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
        return;
    }
    // ตรวจสอบว่า Guild นี้กำลังถูก Monitor อยู่หรือไม่
    if (guildId && !isGuildMonitored(String(guildId))) {
        return; // Guild นี้ถูก disconnect → ไม่ส่ง Webhook
    }
    console.log(`[WEBHOOK] Sending event: ${eventName} (guild: ${guildId || 'N/A'})`);
    
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                event: eventName,
                timestamp: new Date().toISOString(),
                details: payloadData // ครอบด้วยรายละเอียด (details) ตามรูปแบบที่ต้องการ
            })
        });
    } catch (error) {
        // เงียบไว้
    }
}

client.once('ready', async () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    console.log(`Invite link: https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot`);
    try {
        // อัปเดต Cache ของ Guilds และ Roles ตอนเริ่มต้นแบบ Parallel
        const oauthGuilds = await client.guilds.fetch();
        await Promise.all(Array.from(oauthGuilds.values()).map(async (oauthGuild) => {
            try {
                const guild = await oauthGuild.fetch();
                await guild.roles.fetch();
            } catch (err) {
                // ข้าม Guild ที่ไม่มีสิทธิ์เข้าถึงหรือเกิดข้อผิดพลาด
            }
        }));
    } catch (error) {
        // เงียบไว้
    }
});

// ดักจับเหตุการณ์เมื่อมีการสร้าง Role ใหม่ขึ้นมา
client.on('roleCreate', async (role) => {
    await triggerWebhook('role_created', {
        action: 'add',
        target: 'role',
        description: `มีการสร้าง Role ใหม่ชื่อ "${role.name}"`,
        role: {
            id: role.id,
            name: role.name,
            color: role.hexColor,
            position: role.rawPosition
        },
        guild: { id: role.guild.id, name: role.guild.name }
    }, role.guild.id);
});

// ดักจับเหตุการณ์เมื่อมีการลบ Role ทิ้ง
client.on('roleDelete', async (role) => {
    await triggerWebhook('role_deleted', {
        action: 'delete',
        target: 'role',
        description: `มีการลบ Role ชื่อ "${role.name}"`,
        role: {
            id: role.id,
            name: role.name
        },
        guild: { id: role.guild.id, name: role.guild.name }
    }, role.guild.id);
});

// ดักจับเหตุการณ์เมื่อมีการแก้ไข Role ในเซิร์ฟเวอร์
client.on('roleUpdate', async (oldRole, newRole) => {
    const changes = {};
    
    if (oldRole.name !== newRole.name) {
        changes.name = { old: oldRole.name, new: newRole.name };
    }
    if (oldRole.hexColor !== newRole.hexColor) {
        changes.color = { old: oldRole.hexColor, new: newRole.hexColor };
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        changes.permissions = { 
            old: oldRole.permissions.bitfield.toString(), 
            new: newRole.permissions.bitfield.toString() 
        };
    }
    if (oldRole.rawPosition !== newRole.rawPosition) {
        changes.position = { old: oldRole.rawPosition, new: newRole.rawPosition };
    }

    if (Object.keys(changes).length > 0) {
        const changedFields = Object.keys(changes).join(', ');
        await triggerWebhook('role_updated', {
            action: 'update',
            target: 'role',
            description: `มีการแก้ไขข้อมูลของ Role "${newRole.name}" (ฟิลด์ที่เปลี่ยน: ${changedFields})`,
            role: {
                id: newRole.id,
                name: newRole.name,
                changes: changes
            },
            guild: { id: newRole.guild.id, name: newRole.guild.name }
        }, newRole.guild.id);
    }
});

// ดักจับเหตุการณ์เมื่อสมาชิกได้รับหรือถูกถอด Role
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;

    const added = newRoles.filter(role => !oldRoles.has(role.id));
    const removed = oldRoles.filter(role => !newRoles.has(role.id));

    if (added.size > 0) {
        const roleNames = added.map(r => r.name).join(', ');
        await triggerWebhook('member_role_added', {
            action: 'add',
            target: 'member',
            description: `สมาชิก ${newMember.user.tag} ได้รับ Role ใหม่: ${roleNames}`,
            member: {
                username: newMember.user.tag,
                userId: newMember.user.id,
                rolesAdded: added.map(r => ({ id: r.id, name: r.name }))
            },
            guild: { id: newMember.guild.id, name: newMember.guild.name }
        }, newMember.guild.id);
    }
    if (removed.size > 0) {
        const roleNames = removed.map(r => r.name).join(', ');
        await triggerWebhook('member_role_removed', {
            action: 'delete',
            target: 'member',
            description: `สมาชิก ${newMember.user.tag} ถูกถอด Role: ${roleNames}`,
            member: {
                username: newMember.user.tag,
                userId: newMember.user.id,
                rolesRemoved: removed.map(r => ({ id: r.id, name: r.name }))
            },
            guild: { id: newMember.guild.id, name: newMember.guild.name }
        }, newMember.guild.id);
    }
});

// ฟังก์ชันเริ่มการทำงานของบอท
function startBot() {
    if (process.env.DISCORD_TOKEN) {
        client.login(process.env.DISCORD_TOKEN);
    }
}

module.exports = {
    client,
    getRolesList,
    getGuildsList,
    toggleGuildMonitoring,
    isGuildMonitored,
    startBot
};
