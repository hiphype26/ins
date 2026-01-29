// Check if user is authenticated
function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}

// Get current user
function getUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
}

// Logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

// Render navbar
function renderNavbar() {
    const user = getUser();
    const navbar = document.getElementById('navbar');
    
    if (!navbar || !user) return;
    
    navbar.innerHTML = `
        <a href="/" class="navbar-logo">Upwork Job Fetcher</a>
        <div class="navbar-links">
            <a href="/" class="navbar-link">Dashboard</a>
            <a href="/upwork.html" class="navbar-link">Upwork</a>
            <a href="/jobs.html" class="navbar-link">Jobs</a>
            <span class="navbar-user">${user.email}</span>
            <button class="navbar-btn" onclick="logout()">Logout</button>
        </div>
    `;
}
