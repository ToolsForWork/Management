let verifiedIdentity = null;

export async function initializeVerifiedIdentity(employees) {
  try {
    const staticWebAppResponse = await fetch('/.auth/me', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    let profile = null;
    if (staticWebAppResponse.ok) {
      const payload = await staticWebAppResponse.json();
      const principal = payload?.clientPrincipal;
      if (principal) {
        profile = {
          name: principal.userDetails,
          email: principal.userDetails,
          userPrincipalName: principal.userDetails
        };
      }
    }
    if (!profile) {
      const response = await fetch('./api/me', {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return null;
      profile = await response.json();
    }
    const email = String(profile.email || profile.userPrincipalName || '').trim().toLowerCase();
    const name = String(profile.name || profile.displayName || '').trim();
    if (!email && !name) return null;
    const employee = employees.find(candidate =>
      (email && candidate.email?.trim().toLowerCase() === email)
      || (!email && name && candidate.name.toLowerCase() === name.toLowerCase())
    );
    verifiedIdentity = {
      name,
      email,
      employeeId: employee?.id || '',
      source: 'Microsoft Entra ID'
    };
    return verifiedIdentity;
  } catch {
    return null;
  }
}

export function getVerifiedIdentity() {
  return verifiedIdentity;
}
