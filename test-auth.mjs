const BASE = 'http://localhost:3000';

let adminToken = '';
let guestToken = '';
let testResults = [];
let createdUsers = [];

function log(name, pass, detail = '') {
  testResults.push({ name, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
}

async function api(path, options = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  try {
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    return { status: 0, ok: false, data: { error: e.message } };
  }
}

async function login(username, password) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return res;
}

async function verify(token) {
  const res = await api('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  return res;
}

async function runTests() {
  console.log('\n🧪 VibeEnglish 认证系统全面测试\n');
  console.log('='.repeat(60));

  // ===== 第一部分：基础登录 =====
  console.log('\n📋 第一部分：基础登录测试');

  // T1: admin 登录
  {
    const res = await login('admin', 'Admin@2026');
    log('T1: admin 临时密码登录', res.ok, res.ok ? `role=${res.data.role}` : res.data.error);
    if (res.ok) adminToken = res.data.token;
  }

  // T2: 验证 admin token
  {
    const res = await verify(adminToken);
    log('T2: 验证 admin token', res.data.valid && res.data.role === 'admin', `role=${res.data.role}`);
  }

  // T3: 错误密码登录
  {
    const res = await login('admin', 'wrongpassword');
    log('T3: 错误密码登录失败', !res.ok && res.status === 401, res.data.error);
  }

  // T4: 不存在的用户登录
  {
    const res = await login('nonexistent', 'password');
    log('T4: 不存在用户登录失败', !res.ok && res.status === 401, res.data.error);
  }

  // T5: 空用户名密码
  {
    const res = await login('', '');
    log('T5: 空用户名密码登录失败', !res.ok, res.data.error);
  }

  // ===== 第二部分：密码修改 =====
  console.log('\n📋 第二部分：密码修改测试');

  // T6: admin 强制修改密码
  {
    const res = await api('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ newPassword: 'Admin@2026new!' }),
    });
    log('T6: admin 强制修改密码', res.ok, res.ok ? 'success' : res.data.error);
  }

  // T7: 验证 mustChangePassword 已更新
  {
    const res = await verify(adminToken);
    log('T7: 修改密码后 mustChangePassword=false', res.data.valid && res.data.mustChangePassword === false,
      `mustChangePassword=${res.data.mustChangePassword}`);
  }

  // T8: 用新密码登录
  {
    const res = await login('admin', 'Admin@2026new!');
    log('T8: 用新密码登录成功', res.ok, res.ok ? `role=${res.data.role}` : res.data.error);
    if (res.ok) adminToken = res.data.token;
  }

  // T9: 旧密码不能再登录
  {
    const res = await login('admin', 'Admin@2026');
    log('T9: 旧临时密码不能再登录', !res.ok, res.data.error);
  }

  // T10: 非强制修改密码需要旧密码
  {
    const res = await api('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ newPassword: 'Another@2026!' }),
    });
    log('T10: 非强制改密需旧密码', !res.ok, res.data.error);
  }

  // T11: 验证旧密码后修改
  {
    const res = await api('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ oldPassword: 'Admin@2026new!', newPassword: 'Admin@2026new2!' }),
    });
    log('T11: 验证旧密码后修改成功', res.ok, res.ok ? 'success' : res.data.error);
    if (res.ok) {
      const relogin = await login('admin', 'Admin@2026new2!');
      if (relogin.ok) adminToken = relogin.data.token;
    }
  }

  // T12: 密码复杂度不足
  {
    const res = await api('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ oldPassword: 'Admin@2026new2!', newPassword: 'simple' }),
    });
    log('T12: 密码复杂度不足被拒绝', !res.ok, res.data.error);
  }

  // ===== 第三部分：用户管理 =====
  console.log('\n📋 第三部分：用户管理测试');

  // T13: admin 获取用户列表
  {
    const res = await api('/api/admin/users', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    log('T13: admin 获取用户列表', res.ok && Array.isArray(res.data.users),
      `users=${res.data.users?.length}`);
  }

  // T14: 创建普通用户
  {
    const res = await api('/api/admin/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: 'testguest', role: 'guest' }),
    });
    log('T14: 创建普通用户', res.ok, res.ok ? `tempPassword=${res.data.tempPassword}` : res.data.error);
    if (res.ok) createdUsers.push({ username: 'testguest', tempPassword: res.data.tempPassword });
  }

  // T15: 创建管理员用户
  {
    const res = await api('/api/admin/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: 'testadmin2', role: 'admin' }),
    });
    log('T15: 创建管理员用户', res.ok, res.ok ? `tempPassword=${res.data.tempPassword}` : res.data.error);
    if (res.ok) createdUsers.push({ username: 'testadmin2', tempPassword: res.data.tempPassword });
  }

  // T16: 重复用户名创建失败
  {
    const res = await api('/api/admin/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: 'testguest', role: 'guest' }),
    });
    log('T16: 重复用户名创建失败', !res.ok, res.data.error);
  }

  // T17: 非法用户名创建失败
  {
    const res = await api('/api/admin/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: 'ab', role: 'guest' }),
    });
    log('T17: 非法用户名创建失败', !res.ok, res.data.error);
  }

  // ===== 第四部分：权限控制 =====
  console.log('\n📋 第四部分：权限控制测试');

  // T18: 普通用户登录
  {
    if (createdUsers.find(u => u.username === 'testguest')) {
      const tp = createdUsers.find(u => u.username === 'testguest').tempPassword;
      const res = await login('testguest', tp);
      log('T18: 普通用户临时密码登录', res.ok, res.ok ? `mustChangePassword=${res.data.mustChangePassword}` : res.data.error);
      if (res.ok) guestToken = res.data.token;
    } else {
      log('T18: 普通用户临时密码登录', false, '未创建用户');
    }
  }

  // T19: 普通用户修改密码
  {
    if (guestToken) {
      const res = await api('/api/auth/change-password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${guestToken}` },
        body: JSON.stringify({ newPassword: 'Guest@2026!' }),
      });
      log('T19: 普通用户修改密码', res.ok, res.ok ? 'success' : res.data.error);
      if (res.ok) {
        const relogin = await login('testguest', 'Guest@2026!');
        if (relogin.ok) guestToken = relogin.data.token;
      }
    } else {
      log('T19: 普通用户修改密码', false, '无 token');
    }
  }

  // T20: 普通用户不能访问管理接口
  {
    const res = await api('/api/admin/users', {
      headers: { Authorization: `Bearer ${guestToken}` },
    });
    log('T20: 普通用户不能访问管理接口', res.status === 403, `status=${res.status}`);
  }

  // T21: 无 token 不能访问管理接口
  {
    const res = await api('/api/admin/users', {});
    log('T21: 无 token 不能访问管理接口', res.status === 401, `status=${res.status}`);
  }

  // T22: 无效 token 不能访问管理接口
  {
    const res = await api('/api/admin/users', {
      headers: { Authorization: 'Bearer invalidtoken123' },
    });
    log('T22: 无效 token 不能访问管理接口', res.status === 401, `status=${res.status}`);
  }

  // ===== 第五部分：Session 同步（Bug2/3/4 修复验证）=====
  console.log('\n📋 第五部分：Session 同步测试');

  // T23: 修改角色后 session role 同步更新
  {
    const res = await api('/api/admin/users', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'changeRole', username: 'testguest', newRole: 'admin' }),
    });
    if (res.ok) {
      const verifyRes = await verify(guestToken);
      log('T23: 修改角色后 session role 同步', verifyRes.data.role === 'admin',
        `session role=${verifyRes.data.role}`);
    } else {
      log('T23: 修改角色后 session role 同步', false, res.data.error);
    }
  }

  // T24: 改回 guest 角色
  {
    const res = await api('/api/admin/users', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'changeRole', username: 'testguest', newRole: 'guest' }),
    });
    if (res.ok) {
      const verifyRes = await verify(guestToken);
      log('T24: 改回 guest 后 session role 同步', verifyRes.data.role === 'guest',
        `session role=${verifyRes.data.role}`);
    } else {
      log('T24: 改回 guest 后 session role 同步', false, res.data.error);
    }
  }

  // T25: 禁用用户后 session 失效
  {
    const res = await api('/api/admin/users', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'toggleDisabled', username: 'testguest' }),
    });
    if (res.ok && res.data.disabled) {
      const verifyRes = await verify(guestToken);
      log('T25: 禁用用户后 session 失效', !verifyRes.data.valid,
        `valid=${verifyRes.data.valid}`);
    } else {
      log('T25: 禁用用户后 session 失效', false, res.data.error || 'not disabled');
    }
  }

  // T26: 启用用户
  {
    const res = await api('/api/admin/users', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ action: 'toggleDisabled', username: 'testguest' }),
    });
    log('T26: 启用用户', res.ok && !res.data.disabled, `disabled=${res.data.disabled}`);
  }

  // T27: 重置密码后 session 失效
  {
    const relogin = await login('testguest', 'Guest@2026!');
    if (relogin.ok) guestToken = relogin.data.token;

    const res = await api('/api/admin/users', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: 'testguest' }),
    });
    if (res.ok) {
      const verifyRes = await verify(guestToken);
      log('T27: 重置密码后 session 失效', !verifyRes.data.valid,
        `valid=${verifyRes.data.valid}`);
    } else {
      log('T27: 重置密码后 session 失效', false, res.data.error);
    }
  }

  // ===== 第六部分：终端限制 =====
  console.log('\n📋 第六部分：终端限制测试');

  // T28: 同一用户3个终端限制（需要先改密码，因为临时密码是一次性的）
  {
    const tp = createdUsers.find(u => u.username === 'testadmin2')?.tempPassword || '';
    const firstLogin = await login('testadmin2', tp);
    let testadmin2Password = 'TestAdmin2@2026!';
    if (firstLogin.ok) {
      await api('/api/auth/change-password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${firstLogin.data.token}` },
        body: JSON.stringify({ newPassword: testadmin2Password }),
      });
      await api('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${firstLogin.data.token}` },
      });
    }

    const sessions = [];
    for (let i = 0; i < 3; i++) {
      const res = await login('testadmin2', testadmin2Password);
      if (res.ok) sessions.push(res.data.token);
    }
    log('T28: 创建3个终端成功', sessions.length === 3, `sessions=${sessions.length}`);

    const res4 = await login('testadmin2', testadmin2Password);
    log('T29: 第4个终端被拒绝', !res4.ok && res4.status === 403, res4.data.error);

    // 清理：踢出一个 session
    if (sessions.length > 0) {
      await api('/api/admin/users', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'kickSession', token: sessions[0] }),
      });
    }
  }

  // ===== 第七部分：删除用户 =====
  console.log('\n📋 第七部分：删除用户测试');

  // T30: 不能删除 admin
  {
    const res = await api('/api/admin/users', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    });
    log('T30: 不能删除 admin', !res.ok, res.data.error);
  }

  // T31: 不能删除自己
  {
    const res = await api('/api/admin/users', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    });
    log('T31: 不能删除自己', !res.ok, res.data.error);
  }

  // T32: 删除用户后 session 失效
  {
    const relogin = await login('testguest', createdUsers.find(u => u.username === 'testguest')?.tempPassword || '');
    let delToken = '';
    if (relogin.ok) {
      delToken = relogin.data.token;
      await api('/api/auth/change-password', {
        method: 'POST',
        headers: { Authorization: `Bearer ${delToken}` },
        body: JSON.stringify({ newPassword: 'ToDelete@2026!' }),
      });
      const relogin2 = await login('testguest', 'ToDelete@2026!');
      if (relogin2.ok) delToken = relogin2.data.token;
    }

    const res = await api('/api/admin/users', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testguest' }),
    });
    if (res.ok && delToken) {
      const verifyRes = await verify(delToken);
      log('T32: 删除用户后 session 失效', !verifyRes.data.valid, `valid=${verifyRes.data.valid}`);
    } else {
      log('T32: 删除用户后 session 失效', res.ok, res.ok ? 'deleted' : res.data.error);
    }
  }

  // ===== 第八部分：退出登录 =====
  console.log('\n📋 第八部分：退出登录测试');

  // T33: 退出登录后 token 失效
  {
    const relogin = await login('testadmin2', 'TestAdmin2@2026!');
    if (relogin.ok) {
      const logoutToken = relogin.data.token;
      await api('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${logoutToken}` },
      });
      const verifyRes = await verify(logoutToken);
      log('T33: 退出登录后 token 失效', !verifyRes.data.valid, `valid=${verifyRes.data.valid}`);
    } else {
      log('T33: 退出登录后 token 失效', false, 'login failed');
    }
  }

  // ===== 清理测试数据 =====
  console.log('\n🧹 清理测试数据...');
  await api('/api/admin/users', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testadmin2' }),
  });

  // ===== 结果汇总 =====
  console.log('\n' + '='.repeat(60));
  const passed = testResults.filter(r => r.pass).length;
  const failed = testResults.filter(r => !r.pass).length;
  console.log(`\n📊 测试结果: ${passed} 通过, ${failed} 失败, 共 ${testResults.length} 项\n`);

  if (failed > 0) {
    console.log('❌ 失败的测试:');
    testResults.filter(r => !r.pass).forEach(r => {
      console.log(`   - ${r.name}: ${r.detail}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('测试执行出错:', e);
  process.exit(1);
});
