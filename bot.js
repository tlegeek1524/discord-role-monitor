const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GatewayIntents || GatewayIntentBits.GuildMessages
    ]
});

// ฟังก์ชันดึงรายชื่อ Role ทั้งหมด
async function getRolesList() {
    const rolesList = [];
    try {
        const guilds = await client.guilds.cache;
        for (const [guildId, guild] of guilds) {
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
        }
    } catch (error) {
        // เงียบไว้
    }
    return rolesList;
}

// ฟังก์ชันส่ง Webhook แจ้งเตือนอัปเดตแบบ Real-time ไปยัง Backend อื่น
async function triggerWebhook(eventName, payloadData = {}) {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
        return;
    }
    
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
    try {
        // อัปเดต Cache ของ Guilds และ Roles ตอนเริ่มต้น
        const guilds = await client.guilds.fetch();
        for (const [guildId, oauthGuild] of guilds) {
            const guild = await oauthGuild.fetch();
            await guild.roles.fetch();
        }
    } catch (error) {
        // เงียบไว้
    }
});

// ดักจับเหตุการณ์เมื่อมีการสร้าง Role ใหม่ขึ้นมา
client.on('roleCreate', async (role) => {
    await triggerWebhook('role_created', {
        action: 'add', // บอกว่าเป็นการเพิ่มเข้ามา
        target: 'role',
        description: `มีการสร้าง Role ใหม่ชื่อ "${role.name}"`,
        role: {
            id: role.id,
            name: role.name,
            color: role.hexColor,
            position: role.rawPosition
        }
    });
});

// ดักจับเหตุการณ์เมื่อมีการลบ Role ทิ้ง
client.on('roleDelete', async (role) => {
    await triggerWebhook('role_deleted', {
        action: 'delete', // บอกว่าเป็นการลบทิ้ง
        target: 'role',
        description: `มีการลบ Role ชื่อ "${role.name}"`,
        role: {
            id: role.id,
            name: role.name
        }
    });
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
            action: 'update', // บอกว่าเป็นการอัปเดต
            target: 'role',
            description: `มีการแก้ไขข้อมูลของ Role "${newRole.name}" (ฟิลด์ที่เปลี่ยน: ${changedFields})`,
            role: {
                id: newRole.id,
                name: newRole.name,
                changes: changes
            }
        });
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
            action: 'add', // สมาชิกได้ Role เพิ่ม
            target: 'member',
            description: `สมาชิก ${newMember.user.tag} ได้รับ Role ใหม่: ${roleNames}`,
            member: {
                username: newMember.user.tag,
                userId: newMember.user.id,
                rolesAdded: added.map(r => ({ id: r.id, name: r.name }))
            }
        });
    }
    if (removed.size > 0) {
        const roleNames = removed.map(r => r.name).join(', ');
        await triggerWebhook('member_role_removed', {
            action: 'delete', // สมาชิกถูกลบ Role ออก
            target: 'member',
            description: `สมาชิก ${newMember.user.tag} ถูกถอด Role: ${roleNames}`,
            member: {
                username: newMember.user.tag,
                userId: newMember.user.id,
                rolesRemoved: removed.map(r => ({ id: r.id, name: r.name }))
            }
        });
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
    startBot
};
