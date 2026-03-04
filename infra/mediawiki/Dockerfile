FROM mediawiki:1.43

# Install dependencies
RUN apt-get update && apt-get install -y unzip git && rm -rf /var/lib/apt/lists/*

# Install composer
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Install PluggableAuth
RUN curl -L https://github.com/wikimedia/mediawiki-extensions-PluggableAuth/archive/refs/heads/REL1_43.tar.gz | tar xz -C /var/www/html/extensions && \
    mv /var/www/html/extensions/mediawiki-extensions-PluggableAuth-REL1_43 /var/www/html/extensions/PluggableAuth && \
    cd /var/www/html/extensions/PluggableAuth && \
    COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev \
    
RUN curl -L https://github.com/wikimedia/mediawiki-extensions-OpenIDConnect/archive/refs/heads/REL1_43.tar.gz | tar xz -C /var/www/html/extensions && \
    mv /var/www/html/extensions/mediawiki-extensions-OpenIDConnect-REL1_43 /var/www/html/extensions/OpenIDConnect && \
    cd /var/www/html/extensions/OpenIDConnect && \
    COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev

# Install Citizen skin
RUN curl -L https://github.com/StarCitizenTools/mediawiki-skins-Citizen/archive/refs/heads/main.tar.gz | tar xz -C /var/www/html/skins && \
    mv /var/www/html/skins/mediawiki-skins-Citizen-main /var/www/html/skins/Citizen